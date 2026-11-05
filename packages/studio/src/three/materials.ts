import * as THREE from "three";
import { MATERIALS, materialById, type MaterialPreset } from "@brusshy/core";

/**
 * MATERIALS presets → MeshPhysicalMaterial. Materials are cached by their
 * resolved parameters so a doc with 50 nodes in 3 colors makes 3 materials.
 */

export interface MaterialInput {
  presetId: string;
  overrides?: Record<string, unknown>;
  /** The node's paint as a color (null = no paint, use preset color). */
  paint: THREE.Color | null;
  /** Geometry carries gradient vertex colors. */
  vertexColors: boolean;
  opacity: number;
  /** World units per artboard unit (thickness is authored in artboard units). */
  worldScale: number;
}

export function resolvePreset(id: string, overrides?: Record<string, unknown>): MaterialPreset {
  const base = materialById(id) ?? MATERIALS[0]!;
  if (!overrides || !Object.keys(overrides).length) return base;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined && v !== null) clean[k] = v;
  return { ...base, ...clean } as MaterialPreset;
}

const white = new THREE.Color(1, 1, 1);

function color(s: string | undefined, fallback = "#ffffff"): THREE.Color {
  const c = new THREE.Color();
  try {
    c.setStyle(s ?? fallback);
  } catch {
    c.setStyle(fallback);
  }
  return c;
}

/** Relative luminance of a linear color. */
const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const hsl = (c: THREE.Color) => c.getHSL({ h: 0, s: 0, l: 0 });

/** Neon needs light: neutral (black/gray/white) paints become a white tube; colors keep their hue. */
function neonColor(c: THREE.Color): THREE.Color {
  const { h, s, l } = hsl(c);
  if (s < 0.2 || l < 0.1) return new THREE.Color().setHSL(0.95, 0.3, 0.86);
  return new THREE.Color().setHSL(h, Math.max(s, 0.75), THREE.MathUtils.clamp(l, 0.5, 0.62));
}

export function materialKey(m: MaterialInput): string {
  const p = resolvePreset(m.presetId, m.overrides);
  return [
    JSON.stringify(p),
    m.paint ? m.paint.getHexString() : "-",
    m.vertexColors ? 1 : 0,
    m.opacity.toFixed(3),
    m.worldScale.toPrecision(4),
  ].join("|");
}

export function createMaterial(m: MaterialInput): THREE.MeshPhysicalMaterial {
  const p = resolvePreset(m.presetId, m.overrides);
  const tint = p.tintFromFill && m.paint ? m.paint.clone() : color(p.color);
  const useVC = p.tintFromFill && m.vertexColors;
  const isGlass = (p.transmission ?? 0) > 0;
  const isNeon = !!p.emissiveFromFill;

  const mat = new THREE.MeshPhysicalMaterial({
    color: useVC ? white.clone() : tint,
    metalness: p.metalness,
    roughness: p.roughness,
    clearcoat: p.clearcoat ?? 0,
    clearcoatRoughness: p.clearcoatRoughness ?? 0,
    envMapIntensity: p.envMapIntensity ?? 1,
    vertexColors: useVC,
  });

  if (p.sheen) {
    mat.sheen = p.sheen;
    // Sheen takes the paint's hue so dark logos stay deep instead of turning velvet-gray.
    mat.sheenColor = useVC ? color(p.sheenColor) : color(p.sheenColor).multiply(tint.clone().lerp(white, 0.25));
    mat.sheenRoughness = 0.5;
  }
  if (p.iridescence) {
    mat.iridescence = p.iridescence;
    mat.iridescenceIOR = p.iridescenceIOR ?? 1.3;
    mat.iridescenceThicknessRange = [180, 520];
  }
  if (p.anisotropy) {
    mat.anisotropy = p.anisotropy;
    mat.anisotropyRotation = 0;
  }

  if (isGlass) {
    mat.transmission = p.transmission ?? 1;
    mat.thickness = (p.thickness ?? 10) * m.worldScale;
    mat.ior = p.ior ?? 1.5;
    mat.specularIntensity = 1;
    // Tinted glass: keep the surface bright, push the brand color into the volume.
    // Only chromatic paints tint the glass; black/gray/white logos stay crystal clear.
    const tinted = p.tintFromFill && m.paint && hsl(m.paint).s > 0.15 && lum(m.paint) < 0.85;
    if (tinted && m.paint) {
      const sat = m.paint.clone();
      mat.color = useVC ? white.clone() : white.clone().lerp(sat, 0.4);
      mat.attenuationColor = sat.clone().lerp(white, 0.1);
      mat.attenuationDistance = Math.max(mat.thickness * 0.7, 1e-3);
    } else if (!useVC) {
      // Clear/frosted: a whisper of cool tint in the body so the glass reads on light grounds.
      const frosted = p.roughness > 0.1;
      mat.color = frosted ? new THREE.Color("#e8eef4") : white.clone();
      mat.attenuationColor = new THREE.Color(frosted ? "#9fb3c6" : "#d9e6f0");
      mat.attenuationDistance = Math.max(mat.thickness * (frosted ? 0.9 : 1.6), 1e-3);
    }
    if (p.roughness < 0.1) mat.dispersion = 0.35;
  }

  if (isNeon) {
    const glow = neonColor(p.tintFromFill && m.paint ? m.paint : color(p.color));
    // A tube: deep body color, light coming from inside. Emission is normalized by
    // luminance so white and saturated reds bloom about the same amount.
    const k = Math.min(4, 0.45 / Math.max(lum(glow), 0.05));
    mat.color = useVC ? white.clone() : glow.clone().multiplyScalar(0.3);
    mat.emissive = useVC ? white.clone() : glow.clone().multiplyScalar(k);
    mat.emissiveIntensity = p.emissiveIntensity ?? 2;
    mat.clearcoat = Math.max(mat.clearcoat, 0.6);
    mat.clearcoatRoughness = 0.15;
    if (useVC) {
      // Vertex colors normally tint only the diffuse; let them tint the glow too.
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n diffuseColor.rgb *= 0.35;\n#endif",
        );
      };
      mat.customProgramCacheKey = () => "brusshy-neon-vc";
    }
  } else if (p.emissiveIntensity && p.emissiveIntensity > 0) {
    mat.emissive = tint.clone();
    mat.emissiveIntensity = p.emissiveIntensity;
  }

  if (m.opacity < 1) {
    mat.transparent = true;
    mat.opacity = m.opacity;
    mat.depthWrite = m.opacity > 0.6;
  }
  mat.name = p.id;
  return mat;
}

export class MaterialCache {
  private map = new Map<string, THREE.MeshPhysicalMaterial>();
  private used = new Set<string>();

  get(m: MaterialInput): THREE.MeshPhysicalMaterial {
    const k = materialKey(m);
    this.used.add(k);
    let mat = this.map.get(k);
    if (!mat) {
      mat = createMaterial(m);
      this.map.set(k, mat);
    }
    return mat;
  }

  sweep() {
    for (const [k, mat] of this.map) {
      if (!this.used.has(k)) {
        mat.dispose();
        this.map.delete(k);
      }
    }
    this.used.clear();
  }

  dispose() {
    for (const m of this.map.values()) m.dispose();
    this.map.clear();
    this.used.clear();
  }
}
