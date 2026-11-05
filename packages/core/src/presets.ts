/**
 * 3D style presets as plain data. The studio maps materials onto three.js
 * MeshPhysicalMaterial; agents read the same list through MCP.
 * They capture a *look* (glass, chrome…), never another brand's logo.
 */

export interface MaterialPreset {
  id: string;
  label: string;
  description: string;
  /** Use the node's 2D fill as the base color. If false, `color` wins. */
  tintFromFill: boolean;
  color: string;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  transmission?: number;
  thickness?: number;
  ior?: number;
  iridescence?: number;
  iridescenceIOR?: number;
  sheen?: number;
  sheenColor?: string;
  anisotropy?: number;
  emissiveFromFill?: boolean;
  emissiveIntensity?: number;
  envMapIntensity?: number;
  /** Suggested scene bloom when this material dominates. */
  bloom?: number;
}

export const MATERIALS: MaterialPreset[] = [
  {
    id: "soft-plastic",
    label: "Soft plastic",
    description: "Matte toy-like plastic with a soft sheen. Friendly, modern, reads the 2D colors faithfully.",
    tintFromFill: true,
    color: "#ffffff",
    metalness: 0,
    roughness: 0.42,
    clearcoat: 0.35,
    clearcoatRoughness: 0.4,
    sheen: 0.4,
    sheenColor: "#ffffff",
  },
  {
    id: "glossy-enamel",
    label: "Glossy enamel",
    description: "Lacquered, candy-like gloss. App-icon polish.",
    tintFromFill: true,
    color: "#ffffff",
    metalness: 0,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  },
  {
    id: "frosted-glass",
    label: "Frosted glass",
    description: "Translucent satin glass that glows with the environment. Premium, airy.",
    tintFromFill: true,
    color: "#ffffff",
    metalness: 0,
    roughness: 0.32,
    transmission: 1,
    thickness: 18,
    ior: 1.45,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.2,
  },
  {
    id: "clear-glass",
    label: "Clear glass",
    description: "Crystal-clear refractive glass with crisp highlights.",
    tintFromFill: true,
    color: "#ffffff",
    metalness: 0,
    roughness: 0.04,
    transmission: 1,
    thickness: 14,
    ior: 1.5,
    envMapIntensity: 1.4,
  },
  {
    id: "polished-chrome",
    label: "Polished chrome",
    description: "Mirror chrome. Bold, high-contrast reflections.",
    tintFromFill: false,
    color: "#f4f5f6",
    metalness: 1,
    roughness: 0.06,
    envMapIntensity: 1.3,
  },
  {
    id: "brushed-metal",
    label: "Brushed metal",
    description: "Satin aluminium with directional brushing. Industrial, precise.",
    tintFromFill: false,
    color: "#c9ccd0",
    metalness: 1,
    roughness: 0.34,
    anisotropy: 0.8,
  },
  {
    id: "gold",
    label: "Gold",
    description: "Warm polished gold. Luxury, heritage, 1800s engravings.",
    tintFromFill: false,
    color: "#e6b85c",
    metalness: 1,
    roughness: 0.16,
    envMapIntensity: 1.2,
  },
  {
    id: "copper",
    label: "Copper",
    description: "Warm satin copper. Craft, rustic, artisanal.",
    tintFromFill: false,
    color: "#d08a5b",
    metalness: 1,
    roughness: 0.28,
  },
  {
    id: "iridescent",
    label: "Iridescent",
    description: "Pearl-like thin-film shimmer. Futuristic, web3, holographic.",
    tintFromFill: true,
    color: "#ffffff",
    metalness: 0.2,
    roughness: 0.2,
    iridescence: 1,
    iridescenceIOR: 1.6,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  },
  {
    id: "neon",
    label: "Neon",
    description: "Self-lit tube glow in the 2D colors. Nightlife, gaming, retro.",
    tintFromFill: true,
    color: "#ffffff",
    metalness: 0,
    roughness: 0.4,
    emissiveFromFill: true,
    emissiveIntensity: 2.2,
    bloom: 1.2,
  },
  {
    id: "ceramic",
    label: "Ceramic",
    description: "Glazed porcelain with soft highlights. Calm, refined.",
    tintFromFill: true,
    color: "#ffffff",
    metalness: 0,
    roughness: 0.25,
    clearcoat: 0.8,
    clearcoatRoughness: 0.15,
  },
  {
    id: "stone",
    label: "Carved stone",
    description: "Matte mineral surface. Monumental, timeless, rustic.",
    tintFromFill: true,
    color: "#ffffff",
    metalness: 0,
    roughness: 0.9,
  },
];

export interface LightingPreset {
  id: string;
  label: string;
  description: string;
  exposure: number;
  envIntensity: number;
  ambient: number;
  /** Lights: position is relative to the logo (unit ~ logo size). */
  lights: { color: string; intensity: number; position: [number, number, number] }[];
}

export const LIGHTING: LightingPreset[] = [
  {
    id: "studio",
    label: "Studio",
    description: "Soft key + fill + rim. Balanced product photography.",
    exposure: 1,
    envIntensity: 1,
    ambient: 0.15,
    lights: [
      { color: "#ffffff", intensity: 2.2, position: [-1.2, 1.4, 2] },
      { color: "#dfe8ff", intensity: 0.8, position: [1.6, 0.2, 1.4] },
      { color: "#ffffff", intensity: 1.6, position: [0.4, 1.2, -1.8] },
    ],
  },
  {
    id: "dramatic",
    label: "Dramatic",
    description: "Hard side light with deep shadows. Bold, cinematic.",
    exposure: 0.9,
    envIntensity: 0.45,
    ambient: 0.04,
    lights: [
      { color: "#ffffff", intensity: 3.4, position: [-2, 0.6, 1.2] },
      { color: "#9fb4ff", intensity: 1.4, position: [1.8, 1, -1.6] },
    ],
  },
  {
    id: "golden-hour",
    label: "Golden hour",
    description: "Warm low sun and cool shadows. Heritage, rustic, cozy.",
    exposure: 1.05,
    envIntensity: 0.7,
    ambient: 0.1,
    lights: [
      { color: "#ffc98a", intensity: 2.8, position: [-1.8, 0.5, 1.6] },
      { color: "#8fb0ff", intensity: 0.7, position: [1.6, 1.2, 1] },
    ],
  },
  {
    id: "flat",
    label: "Flat",
    description: "Even, shadowless light. Closest to the 2D colors.",
    exposure: 1,
    envIntensity: 1.2,
    ambient: 0.6,
    lights: [{ color: "#ffffff", intensity: 1, position: [0, 0, 2] }],
  },
  {
    id: "night",
    label: "Night",
    description: "Dark ambience made for neon and emissive materials.",
    exposure: 0.85,
    envIntensity: 0.25,
    ambient: 0.03,
    lights: [
      { color: "#7a5cff", intensity: 1.2, position: [-1.6, 1, 1.2] },
      { color: "#00d1ff", intensity: 1, position: [1.6, -0.4, 1.2] },
    ],
  },
];

/** One-click looks: a material + lighting + extrusion combo. */
export interface StylePreset {
  id: string;
  label: string;
  material: string;
  lighting: string;
  depth: number;
  bevel: number;
  bloom: number;
  background: string | null;
}

export const STYLES: StylePreset[] = [
  { id: "clean-plastic", label: "Clean plastic", material: "soft-plastic", lighting: "studio", depth: 24, bevel: 4, bloom: 0, background: null },
  { id: "app-icon", label: "App icon gloss", material: "glossy-enamel", lighting: "studio", depth: 18, bevel: 6, bloom: 0, background: null },
  { id: "frosted", label: "Frosted glass", material: "frosted-glass", lighting: "studio", depth: 30, bevel: 6, bloom: 0, background: "#eef0f2" },
  { id: "crystal", label: "Crystal", material: "clear-glass", lighting: "dramatic", depth: 32, bevel: 5, bloom: 0, background: "#0b0c0e" },
  { id: "chrome", label: "Chrome", material: "polished-chrome", lighting: "studio", depth: 26, bevel: 5, bloom: 0, background: null },
  { id: "brushed", label: "Brushed metal", material: "brushed-metal", lighting: "dramatic", depth: 22, bevel: 3, bloom: 0, background: null },
  { id: "gilded", label: "Gilded", material: "gold", lighting: "golden-hour", depth: 20, bevel: 4, bloom: 0, background: "#14110d" },
  { id: "forged-copper", label: "Forged copper", material: "copper", lighting: "golden-hour", depth: 22, bevel: 3, bloom: 0, background: null },
  { id: "holo", label: "Holographic", material: "iridescent", lighting: "studio", depth: 22, bevel: 6, bloom: 0, background: null },
  { id: "neon-sign", label: "Neon sign", material: "neon", lighting: "night", depth: 8, bevel: 4, bloom: 1.2, background: "#07070a" },
  { id: "porcelain", label: "Porcelain", material: "ceramic", lighting: "studio", depth: 22, bevel: 7, bloom: 0, background: "#f4f5f5" },
  { id: "monument", label: "Monument", material: "stone", lighting: "dramatic", depth: 40, bevel: 2, bloom: 0, background: "#e9e6e0" },
];

export const materialById = (id: string) => MATERIALS.find((m) => m.id === id);
export const lightingById = (id: string) => LIGHTING.find((l) => l.id === id);
export const styleById = (id: string) => STYLES.find((s) => s.id === id);
