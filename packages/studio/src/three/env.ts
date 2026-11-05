import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * Procedural photo-studio environments (one per lighting preset): a graded
 * cyclorama plus softboxes and strip lights. Metals and glass get the crisp
 * stripe reflections of product photography without shipping an HDRI.
 * `environment: "basic"` falls back to three's RoomEnvironment.
 */

interface Box {
  /** Center position (world, logo at origin, room radius ~20). */
  pos: [number, number, number];
  size: [number, number];
  color: string;
  intensity: number;
  /** Roll around the facing axis, degrees (diagonal strips). */
  roll?: number;
  /** Bright at the top edge, fading to black at the bottom (bounce cards). */
  fade?: boolean;
}

interface EnvRecipe {
  top: string;
  horizon: string;
  floor: string;
  /** Overall multiplier for the cyclorama. */
  room: number;
  /** Elevation (sin) where the floor fades into the sky. */
  horizonAt?: number;
  boxes: Box[];
}

const RECIPES: Record<string, EnvRecipe> = {
  studio: {
    top: "#f4f6f8",
    horizon: "#7d838a",
    floor: "#121315",
    room: 0.85,
    horizonAt: 0.08,
    boxes: [
      { pos: [-7, 6, 7], size: [7, 4.5], color: "#ffffff", intensity: 4.5 }, // key softbox
      { pos: [4.5, 2.2, 10], size: [1.6, 11], color: "#ffffff", intensity: 5.5, roll: 28 }, // front diagonal strip
      { pos: [10, 1, 1], size: [1.4, 10], color: "#f2f5ff", intensity: 4.5 }, // right strip
      { pos: [-10, 0.5, -2], size: [1.2, 10], color: "#ffffff", intensity: 3.5 }, // left strip
      { pos: [0, 11, 0], size: [9, 7], color: "#ffffff", intensity: 1.6 }, // overhead
      { pos: [2, 4, -10], size: [10, 2], color: "#ffffff", intensity: 3 }, // rim
      { pos: [-1, -5, 10], size: [18, 6], color: "#ffffff", intensity: 2.4, fade: true }, // bounce card
    ],
  },
  dramatic: {
    top: "#4a4e55",
    horizon: "#1a1b1e",
    floor: "#050506",
    room: 0.45,
    horizonAt: 0.12,
    boxes: [
      { pos: [-10, 1.5, 4], size: [1.6, 11], color: "#ffffff", intensity: 8 },
      { pos: [3.5, 3, 10], size: [1.2, 12], color: "#ffffff", intensity: 4, roll: 32 },
      { pos: [9, 3, -6], size: [1, 8], color: "#b7c6ff", intensity: 5 },
      { pos: [0, 11, 1], size: [5, 3], color: "#ffffff", intensity: 1.4 },
    ],
  },
  "golden-hour": {
    top: "#b8c2d6",
    horizon: "#e8a565",
    floor: "#24180f",
    room: 0.75,
    horizonAt: 0.06,
    boxes: [
      { pos: [-9, 2.5, 6], size: [7, 3], color: "#ffbd6e", intensity: 7 }, // low sun
      { pos: [4.5, 2, 10], size: [1.6, 11], color: "#ffe2bd", intensity: 4.5, roll: 28 },
      { pos: [9, 3, 3], size: [1.4, 8], color: "#a9c2ff", intensity: 2.6 },
      { pos: [1, 3, -10], size: [8, 2], color: "#ffd9a8", intensity: 3 },
      { pos: [0, 11, 0], size: [8, 5], color: "#fff2e2", intensity: 1 },
      { pos: [-1, -5, 10], size: [18, 6], color: "#ffd2a0", intensity: 2.2, fade: true },
    ],
  },
  flat: {
    top: "#f4f6f7",
    horizon: "#dde0e2",
    floor: "#a4a9ad",
    room: 1,
    boxes: [
      { pos: [0, 2, 11], size: [12, 8], color: "#ffffff", intensity: 1.6 },
      { pos: [0, 11, 0], size: [10, 10], color: "#ffffff", intensity: 1.3 },
    ],
  },
  night: {
    top: "#1b1730",
    horizon: "#0d0b16",
    floor: "#030305",
    room: 0.5,
    horizonAt: 0.1,
    boxes: [
      { pos: [-9, 1.5, 4], size: [1.3, 9], color: "#8a5cff", intensity: 6 },
      { pos: [9, 0.5, 4], size: [1.3, 9], color: "#00c8ff", intensity: 5.5 },
      { pos: [3.5, 2, 10], size: [1, 10], color: "#ff4fa8", intensity: 2.2, roll: 30 },
      { pos: [0, 9, -4], size: [7, 1.2], color: "#ff3d9a", intensity: 1.8 },
    ],
  },
};

function cycloramaMaterial(r: EnvRecipe): THREE.ShaderMaterial {
  const c = (s: string) => new THREE.Color(s).multiplyScalar(r.room);
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: c(r.top) },
      horizon: { value: c(r.horizon) },
      floor: { value: c(r.floor) },
      at: { value: r.horizonAt ?? 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 floor; uniform float at;
      varying vec3 vDir;
      void main() {
        float y = vDir.y - at;
        vec3 col = y > 0.0
          ? mix(horizon, top, smoothstep(0.0, 0.6, y))
          : mix(horizon, floor, smoothstep(0.0, 0.18, -y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

function buildEnvScene(id: string): THREE.Scene {
  const r = RECIPES[id] ?? RECIPES.studio!;
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(20, 48, 24), cycloramaMaterial(r));
  scene.add(dome);
  const plane = new THREE.PlaneGeometry(1, 1);
  const faded = new THREE.PlaneGeometry(1, 1, 1, 8);
  {
    const pos = faded.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.pow(THREE.MathUtils.clamp(pos.getY(i) + 0.5, 0, 1), 1.8);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = t;
    }
    faded.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }
  for (const b of r.boxes) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(b.color).multiplyScalar(b.intensity),
      side: THREE.DoubleSide,
      vertexColors: !!b.fade,
    });
    const m = new THREE.Mesh(b.fade ? faded : plane, mat);
    m.position.set(...b.pos);
    m.scale.set(b.size[0], b.size[1], 1);
    m.lookAt(0, 0, 0);
    if (b.roll) m.rotateZ((b.roll * Math.PI) / 180);
    scene.add(m);
  }
  return scene;
}

function disposeScene(s: THREE.Scene) {
  s.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
}

const cache = new WeakMap<THREE.WebGLRenderer, Map<string, THREE.Texture>>();

/** PMREM environment for a lighting preset (cached per renderer). */
export function getEnvironment(renderer: THREE.WebGLRenderer, lightingId: string, kind: string): THREE.Texture {
  let m = cache.get(renderer);
  if (!m) {
    m = new Map();
    cache.set(renderer, m);
  }
  const key = kind === "basic" ? "basic" : lightingId in RECIPES ? lightingId : "studio";
  let tex = m.get(key);
  if (!tex) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const scene = key === "basic" ? new RoomEnvironment() : buildEnvScene(key);
    tex = pmrem.fromScene(scene, key === "basic" ? 0.04 : 0.0, 0.1, 100, { size: 512 }).texture;
    disposeScene(scene as THREE.Scene);
    pmrem.dispose();
    m.set(key, tex);
  }
  return tex;
}

export function disposeEnvironments(renderer: THREE.WebGLRenderer) {
  const m = cache.get(renderer);
  if (!m) return;
  for (const t of m.values()) t.dispose();
  cache.delete(renderer);
}
