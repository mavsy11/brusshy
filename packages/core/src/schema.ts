import { z } from "zod";
import { Animation } from "./animation";
import { Construction } from "./construction-schema";
import { BrandPalette } from "./palette-schema";
import { RepeatRecipe } from "./repeat-schema";
import { RefBoard } from "./board";
import { BriefTags } from "./brief-tags";
import { EffectRecord, WarpRecord } from "./typelab-schema";
import { LetteringSource, TEXT_TYPE_FIELDS, TypeSystem } from "./type-schema";

export const SCHEMA_VERSION = 1;

export const GradientStop = z.object({
  offset: z.number().min(0).max(1),
  color: z.string(),
});

export const Gradient = z.object({
  type: z.enum(["linear", "radial"]),
  /** Degrees, 0 = left→right. Only used by linear gradients. */
  angle: z.number().default(0),
  stops: z.array(GradientStop).min(2),
});

/** A paint is a CSS color string, a gradient, or null (none). */
export const Paint = z.union([z.string(), Gradient, z.null()]);

export const Style = z.object({
  fill: Paint.default("#0b0c0e"),
  stroke: Paint.default(null),
  strokeWidth: z.number().min(0).default(0),
  strokeLinecap: z.enum(["butt", "round", "square"]).default("round"),
  strokeLinejoin: z.enum(["miter", "round", "bevel"]).default("round"),
  opacity: z.number().min(0).max(1).default(1),
  fillRule: z.enum(["nonzero", "evenodd"]).default("nonzero"),
});

export const Transform = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  rotation: z.number().default(0),
  scaleX: z.number().default(1),
  scaleY: z.number().default(1),
});

export const Extrude = z.object({
  /** Extrusion depth in artboard units. */
  depth: z.number().min(0).default(24),
  bevel: z.number().min(0).default(3),
  bevelSegments: z.number().int().min(1).max(16).default(6),
  /** Material preset id (see presets.ts). */
  material: z.string().default("auto"),
  /** Partial material overrides (color, roughness, metalness…). */
  materialOverrides: z.record(z.string(), z.unknown()).default({}),
  /** Z offset in artboard units, to layer parts in depth. */
  z: z.number().default(0),
});

export const Scene = z.object({
  lighting: z.string().default("studio"),
  environment: z.string().default("room"),
  camera: z
    .object({
      azimuth: z.number().default(-18),
      elevation: z.number().default(12),
      fov: z.number().default(30),
      distance: z.number().default(1),
    })
    .default({ azimuth: -18, elevation: 12, fov: 30, distance: 1 }),
  /** Background color for 3D renders, null = transparent. */
  background: z.string().nullable().default(null),
  bloom: z.number().min(0).max(3).default(0),
  shadow: z.boolean().default(true),
  /** Default material for nodes whose extrude.material is "auto". */
  material: z.string().default("soft-plastic"),
  /** Default extrusion depth for nodes without explicit extrude settings. */
  depth: z.number().min(0).default(24),
  bevel: z.number().min(0).default(3),
});

const NodeBase = z.object({
  id: z.string(),
  name: z.string().default(""),
  parent: z.string().nullable().default(null),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  transform: Transform.default({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
  style: Style.default({
    fill: "#0b0c0e",
    stroke: null,
    strokeWidth: 0,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    opacity: 1,
    fillRule: "nonzero",
  }),
  extrude: Extrude.optional(),
  /** Locked for the AI: agents must not change this node (users still can). */
  aiLock: z.boolean().default(false),
  /** Type Lab: last warp applied (re-editable from the original geometry). */
  warp: WarpRecord.nullable().optional(),
  /** Type Lab: this layer is a generated effect (outline, inline, shadow…) of its siblings. */
  effect: EffectRecord.nullable().optional(),
});

export const PathNode = NodeBase.extend({
  type: z.literal("path"),
  /** SVG path data in local coordinates. */
  d: z.string(),
});

export const ShapeNode = NodeBase.extend({
  type: z.literal("shape"),
  shape: z.enum(["rect", "ellipse", "polygon", "star"]),
  width: z.number().min(0),
  height: z.number().min(0),
  /** Corner radius (rect) or point rounding (polygon/star). */
  radius: z.number().min(0).default(0),
  sides: z.number().int().min(3).max(64).default(5),
  /** Inner/outer radius ratio for stars. */
  innerRatio: z.number().min(0.05).max(1).default(0.5),
});

export const TextNode = NodeBase.extend({
  type: z.literal("text"),
  text: z.string(),
  fontFamily: z.string().default("Geist"),
  fontSize: z.number().min(1).default(64),
  fontWeight: z.number().int().min(100).max(900).default(600),
  letterSpacing: z.number().default(0),
  anchor: z.enum(["start", "middle", "end"]).default("start"),
  /** Type controls: variable axes, OpenType features, alternates, kerning (see type-schema.ts). */
  ...TEXT_TYPE_FIELDS,
});

export const GroupNode = NodeBase.extend({
  type: z.literal("group"),
  children: z.array(z.string()).default([]),
  /** Lettering groups: the text and font the letters were outlined from (for glyph alternates). */
  lettering: LetteringSource.nullable().optional(),
  /** Repeat groups: how the copies were made from the source child (see repeat.ts). */
  repeat: RepeatRecipe.nullable().optional(),
});

export const SketchStroke = z.object({
  /** [x, y, pressure] in local coordinates. */
  points: z.array(z.tuple([z.number(), z.number(), z.number()])),
  size: z.number().default(6),
  color: z.string().default("#0b0c0e"),
});

export const SketchNode = NodeBase.extend({
  type: z.literal("sketch"),
  strokes: z.array(SketchStroke).default([]),
});

export const ReferenceNode = NodeBase.extend({
  type: z.literal("reference"),
  /** What the AI should take from this image. */
  role: z.enum(["reference", "palette", "silhouette", "style"]).default("reference"),
  /** Path relative to the project's brusshy/ folder (e.g. refs/compass.png) or a data: URL. */
  src: z.string(),
  width: z.number().min(1),
  height: z.number().min(1),
});

/**
 * A frame is one version of the logo on the canvas: its own artboard size,
 * background and 3D look. Frames are always top-level; transform.x/y place
 * them on the canvas and their children use frame-local (artboard) coordinates.
 */
export const FrameNode = NodeBase.extend({
  type: z.literal("frame"),
  width: z.number().min(1).default(1024),
  height: z.number().min(1).default(1024),
  /** Background color, null = transparent. */
  background: z.string().nullable().default(null),
  children: z.array(z.string()).default([]),
  scene: Scene.default(Scene.parse({})),
  /** Logo animation for this version (see animation.ts). */
  animation: Animation.nullable().optional(),
  /** Variants created together (one request) share a batch id. */
  batch: z.string().nullable().default(null),
  /** Construction layer: guide circles/lines/polygons, never exported (see construction-schema.ts). */
  construction: Construction.nullable().optional(),
});

export const Node = z.discriminatedUnion("type", [
  FrameNode,
  PathNode,
  ShapeNode,
  TextNode,
  GroupNode,
  SketchNode,
  ReferenceNode,
]);

export const Annotation = z.object({
  id: z.string(),
  /** Node the note is pinned to (null = pinned to the artboard). */
  nodeId: z.string().nullable().default(null),
  /** Frame (version) the note belongs to; x/y are in that frame's coordinates. */
  frameId: z.string().nullable().default(null),
  /** Pin position in artboard coordinates. */
  x: z.number(),
  y: z.number(),
  note: z.string(),
  status: z.enum(["pending", "in_progress", "resolved", "dismissed"]).default("pending"),
  reply: z.string().default(""),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const Artboard = z.object({
  width: z.number().min(1).default(1024),
  height: z.number().min(1).default(1024),
  /** Background color, null = transparent. */
  background: z.string().nullable().default(null),
});

/** Structured design brief the AI reads before designing. */
export const Brief = z.object({
  subject: z.string().default(""),
  use: z.string().default(""),
  style: z.string().default(""),
  palette: z.string().default(""),
  typography: z.string().default(""),
  keep: z.string().default(""),
  avoid: z.string().default(""),
  notes: z.string().default(""),
  /** Optional taxonomy chips: mark type, style, shape, mood (see brief-tags.ts). */
  tags: BriefTags.optional(),
});
export type BriefT = z.infer<typeof Brief>;

export const Doc = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  artboard: Artboard.default({ width: 1024, height: 1024, background: null }),
  /** Top-level node ids in paint order (first = bottom). */
  root: z.array(z.string()).default([]),
  nodes: z.record(z.string(), Node).default({}),
  annotations: z.record(z.string(), Annotation).default({}),
  brief: Brief.optional(),
  /** Brand palette as data (see palette-schema.ts). */
  palette: BrandPalette.optional(),
  /** Brand type system: heading + body fonts (see type-schema.ts). */
  typeSystem: TypeSystem.optional(),
  /** Reference board: inspiration images with roles and notes (see board.ts). */
  board: RefBoard.optional(),
  scene: Scene.default(Scene.parse({})),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type GradientT = z.infer<typeof Gradient>;
export type PaintT = z.infer<typeof Paint>;
export type StyleT = z.infer<typeof Style>;
export type TransformT = z.infer<typeof Transform>;
export type ExtrudeT = z.infer<typeof Extrude>;
export type PathNodeT = z.infer<typeof PathNode>;
export type ShapeNodeT = z.infer<typeof ShapeNode>;
export type TextNodeT = z.infer<typeof TextNode>;
export type GroupNodeT = z.infer<typeof GroupNode>;
export type SketchNodeT = z.infer<typeof SketchNode>;
export type SketchStrokeT = z.infer<typeof SketchStroke>;
export type ReferenceNodeT = z.infer<typeof ReferenceNode>;
export type FrameNodeT = z.infer<typeof FrameNode>;
export type NodeT = z.infer<typeof Node>;
export type NodeType = NodeT["type"];
export type AnnotationT = z.infer<typeof Annotation>;
export type SceneT = z.infer<typeof Scene>;
export type ArtboardT = z.infer<typeof Artboard>;
export type DocT = z.infer<typeof Doc>;

/** Node types that end up in exports (sketches and references are working layers). */
export const EXPORTABLE_TYPES: NodeType[] = ["path", "shape", "text", "group"];

/** Node types that hold children. */
export const CONTAINER_TYPES: NodeType[] = ["group", "frame"];
