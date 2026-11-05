import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import {
  LIGHTING,
  lightingById,
  shapeToPath,
  worldMatrix,
  type DocT,
  type NodeT,
  type PaintT,
  type SceneT,
} from "@brusshy/core";
import { textToPath } from "../lib/fonts";
import { GeometryCache, type GeoSpec } from "./geometry";
import { MaterialCache, resolvePreset } from "./materials";
import { getEnvironment, disposeEnvironments } from "./env";
import { ContactShadow } from "./shadow";
import { preToneMapped } from "./tonemap";

/**
 * The single 3D pipeline shared by the interactive view, PNG renders, GLB
 * export and video: doc → extruded logo → lit scene → MSAA HDR target →
 * (bloom) → tone-mapped output.
 */

/** World size of the logo's longest side. */
export const LOGO_SIZE = 2;
const DEG = Math.PI / 180;
const EXPOSURE = 0.82;

export type SceneSettings = SceneT;

export interface BuildResult {
  /** Logo bounds in world units (after centering/scaling). */
  size: THREE.Vector3;
  meshCount: number;
  /** Some text nodes are still waiting for their font. */
  pendingFonts: boolean;
}

function paintColor(p: PaintT): THREE.Color | null {
  if (p === null) return null;
  const c = new THREE.Color();
  if (typeof p === "string") {
    if (p === "none" || p === "transparent") return null;
    try {
      c.setStyle(p);
    } catch {
      return null;
    }
    return c;
  }
  // Gradient: average of the stops (used where vertex colors aren't).
  const acc = new THREE.Color(0, 0, 0);
  for (const s of p.stops) {
    try {
      acc.add(new THREE.Color().setStyle(s.color));
    } catch {
      /* skip */
    }
  }
  return acc.multiplyScalar(1 / Math.max(1, p.stops.length));
}

interface Leaf {
  node: NodeT;
  d: string;
  opacity: number;
  order: number;
}

function collectLeaves(doc: DocT): { leaves: Leaf[]; pendingFonts: boolean } {
  const leaves: Leaf[] = [];
  let pendingFonts = false;
  let order = 0;
  const walk = (ids: string[], opacity: number) => {
    for (const id of ids) {
      const n = doc.nodes[id];
      if (!n || !n.visible) continue;
      const op = opacity * (n.style?.opacity ?? 1);
      if (n.type === "group") {
        walk(n.children, op);
        continue;
      }
      let d: string | null = null;
      if (n.type === "path") d = n.d;
      else if (n.type === "shape") d = shapeToPath(n);
      else if (n.type === "text") {
        d = n.text.trim() ? textToPath(n) : null;
        if (d === null && n.text.trim()) pendingFonts = true;
      }
      if (d && d.trim()) leaves.push({ node: n, d, opacity: op, order: order++ });
    }
  };
  walk(doc.root, 1);
  return { leaves, pendingFonts };
}

const bloomAddShader = {
  uniforms: {
    tBloom: { value: null as THREE.Texture | null },
    uvOffset: { value: new THREE.Vector2() },
    uvScale: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tBloom; uniform vec2 uvOffset; uniform vec2 uvScale;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D(tBloom, uvOffset + vUv * uvScale); }`,
};

export interface StageOptions {
  /** MSAA samples for the main render target. */
  samples?: number;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  /** Animated by turntable/float (rotation + bob). */
  readonly pivot = new THREE.Group();
  /** Centers and scales the logo. */
  readonly logoRoot = new THREE.Group();
  readonly shadow = new ContactShadow();
  private lights = new THREE.Group();
  private ambient = new THREE.AmbientLight(0xffffff, 0.1);
  private geos = new GeometryCache();
  private mats = new MaterialCache();
  private rt: THREE.WebGLRenderTarget;
  private bloom: UnrealBloomPass;
  private output = new OutputPass();
  private bloomAdd = new FullScreenQuad(
    new THREE.ShaderMaterial({ ...bloomAddShader, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }),
  );
  private bloomSrc: THREE.WebGLRenderTarget | null = null;
  private bloomTex: THREE.Texture | null = null;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private shadowDirty = true;
  settings: SceneSettings | null = null;
  size = new THREE.Vector3(LOGO_SIZE, LOGO_SIZE, 0.1);
  transparent = false;
  /** Breathing room around the logo when framing (renders are tighter than the editor view). */
  frameMargin = 1.16;

  constructor(renderer: THREE.WebGLRenderer, o: StageOptions = {}) {
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const maxSamples = renderer.capabilities.maxSamples ?? 4;
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: Math.min(o.samples ?? 4, maxSamples),
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0, 0.12, 0.85);
    // Tighter falloff than the default: a glow around the tubes, not a haze over the frame.
    const u = this.bloom.compositeMaterial.uniforms as Record<string, THREE.IUniform>;
    u.bloomFactors!.value = [1.0, 0.85, 0.5, 0.22, 0.08];
    this.output.renderToScreen = true;

    this.pivot.add(this.logoRoot);
    this.scene.add(this.pivot, this.lights, this.ambient, this.shadow.group);
  }

  // ------------------------------------------------------------- build

  /** Rebuild the logo and scene from a document (geometry/material caches make repeats cheap). */
  setDoc(doc: DocT, override: Partial<SceneSettings> = {}): BuildResult {
    const defined = Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined)) as Partial<SceneSettings>;
    const sc: SceneSettings = { ...doc.scene, ...defined, camera: { ...doc.scene.camera, ...(defined.camera ?? {}) } };
    this.settings = sc;
    const art = Math.max(doc.artboard.width, doc.artboard.height);
    const step = art / 220;
    const stack = art * 0.0011;
    const { leaves, pendingFonts } = collectLeaves(doc);

    // Pass 1: geometry + placement in artboard units.
    interface Part {
      geo: THREE.BufferGeometry;
      pos: THREE.Vector3;
      /** Depth used when the node follows the scene default (for live previews). */
      sceneDepth: number | null;
      leaf: Leaf;
      paint: THREE.Color | null;
      vertexColors: boolean;
      material: string;
      overrides: Record<string, unknown>;
    }
    const parts: Part[] = [];
    const box = new THREE.Box3();
    const tmpBox = new THREE.Box3();
    for (const leaf of leaves) {
      const n = leaf.node;
      const ex = n.extrude;
      const depth = override.depth !== undefined && !ex ? override.depth : (ex?.depth ?? sc.depth);
      const bevel = override.bevel !== undefined && !ex ? override.bevel : (ex?.bevel ?? sc.bevel);
      const material = ex && ex.material && ex.material !== "auto" ? ex.material : sc.material;
      const overrides = (ex?.materialOverrides ?? {}) as Record<string, unknown>;
      const tint = resolvePreset(material, overrides).tintFromFill;
      const m = worldMatrix(doc, n.id);
      const linear: [number, number, number, number] = [m[0], m[1], m[2], m[3]];
      const z = (ex?.z ?? 0) + leaf.order * stack;
      const st = n.style;
      const base = { d: leaf.d, fillRule: st.fillRule, linear, depth, bevel, bevelSegments: ex?.bevelSegments ?? 6, step };
      const specs: { spec: GeoSpec; paint: PaintT; zBias: number }[] = [];
      if (st.fill !== null) {
        specs.push({
          spec: { ...base, kind: "fill", gradient: tint && typeof st.fill === "object" ? st.fill : null },
          paint: st.fill,
          zBias: 0,
        });
      }
      if (st.stroke !== null && st.strokeWidth > 0) {
        specs.push({
          spec: {
            ...base,
            kind: "stroke",
            stroke: { width: st.strokeWidth, cap: st.strokeLinecap, join: st.strokeLinejoin },
            gradient: tint && typeof st.stroke === "object" ? st.stroke : null,
          },
          paint: st.stroke,
          zBias: st.fill !== null ? stack * 0.5 : 0,
        });
      }
      for (const { spec, paint, zBias } of specs) {
        const built = this.geos.get(spec);
        if (!built) continue;
        const pos = new THREE.Vector3(m[4], -m[5], z + zBias);
        tmpBox.copy(built.geometry.boundingBox!).translate(pos);
        box.union(tmpBox);
        parts.push({
          geo: built.geometry,
          pos,
          leaf,
          paint: paintColor(paint) ?? (spec.kind === "fill" ? paintColor(st.stroke) : null),
          vertexColors: !!spec.gradient,
          material,
          overrides,
          sceneDepth: ex ? null : depth,
        });
      }
    }

    // Pass 2: center + scale, then materials (glass thickness depends on scale).
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const raw = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
    const s = LOGO_SIZE / Math.max(raw.x, raw.y, 1e-6);
    this.logoRoot.scale.setScalar(s);
    this.logoRoot.position.copy(center).multiplyScalar(-s);
    this.size.copy(raw).multiplyScalar(s);

    // Reuse mesh objects when possible.
    const old = this.logoRoot.children.slice() as THREE.Mesh[];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      const mat = this.mats.get({
        presetId: p.material,
        overrides: p.overrides,
        paint: p.paint,
        vertexColors: p.vertexColors,
        opacity: p.leaf.opacity,
        worldScale: s,
      });
      let mesh = old[i];
      if (!mesh) {
        mesh = new THREE.Mesh();
        this.logoRoot.add(mesh);
      }
      mesh.geometry = p.geo;
      mesh.material = mat;
      mesh.position.copy(p.pos);
      mesh.name = p.leaf.node.name || p.leaf.node.id;
      mesh.userData.nodeId = p.leaf.node.id;
      mesh.userData.sceneDepth = p.sceneDepth;
      mesh.scale.set(1, 1, 1);
      mesh.castShadow = mat.transmission === 0 && !mat.transparent;
      // Glass lives on reflections: under dim lighting presets it borrows the
      // bright studio environment so its rims and bevels still sparkle.
      if (mat.transmission > 0) {
        const lp = lightingById(sc.lighting) ?? LIGHTING[0]!;
        const base = resolvePreset(p.material, p.overrides).envMapIntensity ?? 1;
        if (lp.envIntensity < 0.6) {
          mat.envMap = getEnvironment(this.renderer, "studio", sc.environment);
          mat.envMapIntensity = base * 2.2;
        } else {
          mat.envMap = null;
          mat.envMapIntensity = base;
        }
      }
    }
    for (let i = parts.length; i < old.length; i++) this.logoRoot.remove(old[i]!);
    this.geos.sweep();
    this.mats.sweep();

    this.applySettings(sc);
    return { size: this.size.clone(), meshCount: parts.length, pendingFonts };
  }

  private applySettings(sc: SceneSettings) {
    const r = this.renderer;
    const light = lightingById(sc.lighting) ?? LIGHTING[0]!;
    // Environment + exposure.
    this.scene.environment = getEnvironment(r, light.id, sc.environment);
    this.scene.environmentIntensity = light.envIntensity;
    // Calibrated so mid-saturated brand colors stay saturated under the studio key.
    r.toneMappingExposure = light.exposure * EXPOSURE;

    // Lights, positioned relative to the logo size.
    for (const l of this.lights.children.slice()) {
      this.lights.remove(l);
      (l as THREE.SpotLight).dispose?.();
    }
    // Soft spotlights rather than directional lights: their falloff paints a
    // gentle gradient across flat faces, which reads as "photographed".
    const R = LOGO_SIZE * 1.9;
    let key: THREE.SpotLight | null = null;
    for (const def of light.lights) {
      const pos = new THREE.Vector3(...def.position).multiplyScalar(R);
      const d2 = pos.lengthSq();
      const sl = new THREE.SpotLight(new THREE.Color(def.color), def.intensity * d2, 0, 0.62, 1, 2);
      sl.position.copy(pos);
      sl.target.position.set(0, 0, 0);
      this.lights.add(sl, sl.target);
      if (!key || def.intensity > key.intensity / Math.max(key.position.lengthSq(), 1e-6)) key = sl;
    }
    if (key && sc.shadow) {
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.near = R * 0.3;
      key.shadow.camera.far = R * 4;
      key.shadow.radius = 5;
      key.shadow.bias = -0.0003;
      key.shadow.normalBias = 0.01;
    }
    this.ambient.intensity = light.ambient * Math.PI;

    // Contact shadow.
    this.shadow.visible = sc.shadow;
    const gap = 0.12;
    const reach = Math.max(this.size.x, this.size.z, this.size.y) * 1.25 + 0.8;
    this.shadow.layout(-this.size.y / 2 - gap, reach, Math.max(this.size.y * 0.65, 0.6));
    const bg = sc.background ? new THREE.Color(sc.background) : null;
    const dark = bg ? bg.r * 0.2126 + bg.g * 0.7152 + bg.b * 0.0722 < 0.08 : false;
    this.shadow.opacity = dark ? 0.85 : 0.55;

    // Background + bloom.
    this.applyBackground();
    this.bloom.strength = sc.bloom * 0.55;
    this.bloom.radius = 0.12;
    this.bloom.threshold = 0.85;
    this.shadowDirty = true;
  }

  /** Cheap live preview while dragging sliders: stretch scene-depth meshes and retune bloom without rebuilding. */
  preview(o: { depth?: number; bloom?: number }) {
    for (const m of this.meshes()) {
      const base = m.userData.sceneDepth as number | null;
      m.scale.z = base && o.depth !== undefined ? Math.max(o.depth, 0.25) / base : 1;
    }
    if (o.bloom !== undefined) this.bloom.strength = o.bloom * 0.55;
    else if (this.settings) this.bloom.strength = this.settings.bloom * 0.55;
    this.shadowDirty = true;
  }

  setTransparent(t: boolean) {
    this.transparent = t;
    this.applyBackground();
  }

  private applyBackground() {
    const bg = this.settings?.background;
    this.scene.background = !this.transparent && bg ? preToneMapped(bg, this.renderer.toneMappingExposure) : null;
  }

  // ------------------------------------------------------------- camera

  /** Camera distance that frames the logo for an aspect ratio (before the doc's distance factor). */
  fitDistance(aspect: number, margin = this.frameMargin): number {
    const fov = this.camera.fov * DEG;
    const tv = Math.tan(fov / 2);
    const th = tv * aspect;
    const w = Math.max(this.size.x, 0.01) * margin;
    const h = Math.max(this.size.y + 0.35, 0.01) * margin;
    return Math.max(h / 2 / tv, w / 2 / th) + this.size.z / 2;
  }

  /** Place the camera on its orbit (degrees), looking at the logo. */
  placeCamera(azimuth: number, elevation: number, distanceFactor = 1, fov?: number, aspect?: number) {
    if (fov) this.camera.fov = fov;
    this.camera.aspect = aspect ?? this.width / this.height;
    this.camera.updateProjectionMatrix();
    const dist = this.fitDistance(this.camera.aspect) * (distanceFactor || 1);
    const az = azimuth * DEG;
    const el = elevation * DEG;
    this.camera.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = Math.max(0.01, dist * 0.02);
    this.camera.far = dist * 20 + 20;
    this.camera.updateProjectionMatrix();
  }

  /** Current camera as orbit angles (degrees) + distance factor. */
  readCamera(target = new THREE.Vector3()) {
    const v = this.camera.position.clone().sub(target);
    const dist = v.length();
    const azimuth = Math.atan2(v.x, v.z) / DEG;
    const elevation = Math.asin(THREE.MathUtils.clamp(v.y / (dist || 1), -1, 1)) / DEG;
    return { azimuth, elevation, distance: dist / this.fitDistance(this.camera.aspect), fov: this.camera.fov };
  }

  // ------------------------------------------------------------- pose / animation

  setPose(rotY: number, bob = 0, tilt = 0) {
    this.pivot.rotation.set(tilt, rotY, 0);
    this.pivot.position.y = bob;
    this.shadowDirty = true;
  }

  invalidateShadow() {
    this.shadowDirty = true;
  }

  // ------------------------------------------------------------- rendering

  setSize(width: number, height: number, pixelRatio = 1, updateStyle = false) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.width, this.height, updateStyle);
    const W = Math.round(this.width * pixelRatio);
    const H = Math.round(this.height * pixelRatio);
    this.rt.setSize(W, H);
    this.output.setSize(W, H);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  /** Bloom is computed at a fixed reference resolution so its look doesn't depend on output size. */
  private bloomRef(aspect: number): [number, number] {
    const ref = 1024;
    return aspect >= 1 ? [ref, Math.max(16, Math.round(ref / aspect))] : [Math.max(16, Math.round(ref * aspect)), ref];
  }

  private updateShadowIfNeeded() {
    if (this.shadowDirty && this.shadow.visible) {
      this.shadow.update(this.renderer, this.scene);
    }
    this.shadowDirty = false;
  }

  /** Render the full frame to the renderer's canvas. */
  render() {
    const r = this.renderer;
    this.updateShadowIfNeeded();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, this.camera);
    if (this.bloom.strength > 0) {
      const [bw, bh] = this.bloomRef(this.width / this.height);
      if (this.bloom.resolution.x !== bw || this.bloom.resolution.y !== bh) {
        this.bloom.resolution.set(bw, bh);
        this.bloom.setSize(bw, bh);
      }
      this.bloom.render(r, this.rt, this.rt, 0, false);
    }
    this.output.render(r, this.rt, this.rt, 0, false);
  }

  /**
   * Tiled rendering for very large outputs: call `beginTiles` once (bakes the
   * shadow and a full-frame bloom), then `renderTile` per tile.
   */
  beginTiles(fullW: number, fullH: number) {
    const r = this.renderer;
    this.updateShadowIfNeeded();
    this.bloomTex = null;
    if (this.bloom.strength > 0) {
      const [bw, bh] = this.bloomRef(fullW / fullH);
      if (!this.bloomSrc) this.bloomSrc = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, samples: 0 });
      this.bloomSrc.setSize(bw, bh);
      this.camera.aspect = fullW / fullH;
      this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(this.bloomSrc);
      r.clear();
      r.render(this.scene, this.camera);
      this.bloom.resolution.set(bw, bh);
      this.bloom.setSize(bw, bh);
      this.bloom.render(r, this.bloomSrc, this.bloomSrc, 0, false);
      // After render, the first horizontal target holds the composited bloom alone.
      this.bloomTex = this.bloom.renderTargetsHorizontal[0]!.texture;
    }
  }

  renderTile(fullW: number, fullH: number, x: number, y: number, w: number, h: number) {
    const r = this.renderer;
    this.camera.aspect = fullW / fullH;
    this.camera.setViewOffset(fullW, fullH, x, y, w, h);
    this.camera.updateProjectionMatrix();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, this.camera);
    if (this.bloomTex) {
      const mat = this.bloomAdd.material as THREE.ShaderMaterial;
      mat.uniforms.tBloom!.value = this.bloomTex;
      mat.uniforms.uvOffset!.value.set(x / fullW, 1 - (y + h) / fullH);
      mat.uniforms.uvScale!.value.set(w / fullW, h / fullH);
      r.setRenderTarget(this.rt);
      const autoClear = r.autoClear;
      r.autoClear = false;
      this.bloomAdd.render(r);
      r.autoClear = autoClear;
    }
    this.output.render(r, this.rt, this.rt, 0, false);
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Materials currently on the logo (for exporters). */
  meshes(): THREE.Mesh[] {
    return this.logoRoot.children as THREE.Mesh[];
  }

  dispose() {
    this.geos.dispose();
    this.mats.dispose();
    this.shadow.dispose();
    this.rt.dispose();
    this.bloomSrc?.dispose();
    this.bloom.dispose();
    this.output.dispose();
    this.bloomAdd.dispose();
    (this.bloomAdd.material as THREE.Material).dispose();
    disposeEnvironments(this.renderer);
  }
}
