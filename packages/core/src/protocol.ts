import type { DocT } from "./schema";
import type { OpT } from "./ops";

/** Wire protocol between the studio (browser) and the local daemon. */

export interface DocMeta {
  id: string;
  name: string;
  file: string;
  updatedAt: number;
}

export type ViewMode = "2d" | "3d" | "split";

export interface AgentStatus {
  state: "idle" | "working";
  message: string;
  at: number;
  /** When the current run of work began (live progress timer). */
  startedAt?: number;
  /** Steps of the current run, oldest first. */
  steps?: { label: string; at: number }[];
}

export type RenderView = "2d" | "3d";

/** One step in the undo timeline, as shown in the History panel. */
export interface TimelineItem {
  label: string;
  author: "user" | "agent";
  at: number;
  ops: number;
}

export interface Timeline {
  items: TimelineItem[];
  /** Number of items currently applied (items after it are undone). */
  cursor: number;
  /** Index of items[0] in the full history (older items were trimmed). */
  offset: number;
}

/** Activity log entry: what changed, by whom — the agent reads the user's ones. */
export interface LogEntry {
  seq: number;
  at: number;
  author: "user" | "agent";
  label: string;
  /** Human-readable details, e.g. `"bean" (n_x): path, position`. */
  details: string[];
}

export interface RenderParams {
  view: RenderView;
  /** Frame (version) to render; defaults to the active one. */
  frame?: string;
  /** Output width in px (height follows the artboard aspect). */
  width?: number;
  /** Transparent background (default true). */
  transparent?: boolean;
  /** Include sketch/reference working layers (2D only). */
  includeWorking?: boolean;
  /** Draw annotation pins (2D only). */
  showAnnotations?: boolean;
  /** 3D camera override in degrees. */
  azimuth?: number;
  elevation?: number;
  /** 2D only: render the version's animation at these times (ms) as one contact sheet. */
  animTimes?: number[];
}

export type ExportFormat =
  | "svg"
  | "png"
  | "mono"
  | "icons"
  | "png3d"
  | "glb"
  | "video"
  | "brandkit"
  /** Logo animation (the version's animation spec): self-contained CSS-animated SVG. */
  | "anim-svg"
  /** Logo animation as MP4 (H.264), WebM fallback. */
  | "anim-video"
  /** Logo animation as a looping GIF. */
  | "gif"
  /** The logo on applications (cards, app icon, sign…), one PNG per scene. */
  | "mockups"
  /** Design timelapse of the version (from its undo history): MP4 (WebM fallback), square and/or vertical. */
  | "timelapse"
  /** Design timelapse as a looping GIF. */
  | "timelapse-gif"
  /** Construction sheet: the mark on its grid (hatched regions, labels) + the clean mark, PNG 2048 + SVG. */
  | "construction";

export interface ExportParams {
  formats: ExportFormat[];
  /** Frame (version) to export; defaults to the active one. */
  frame?: string;
  /** PNG widths for "png" (default [512, 1024, 2048]). */
  pngSizes?: number[];
  /** 3D render width (default 2048). */
  size3d?: number;
  /** Video options. */
  video?: { seconds?: number; fps?: number; size?: number; motion?: "turntable" | "float" };
  /** Logo animation exports: video width (anim-video), GIF width, frame rate, transparency (GIF, WebM). */
  anim?: { size?: number; gifSize?: number; fps?: number; transparent?: boolean };
  /** "mockups": which scenes (default all), PNG width (default 2400); inBrandKit adds an "In use" page to the brand kit. */
  mockups?: { kinds?: import("./mockups").MockupKind[]; size?: number; inBrandKit?: boolean };
  /** "timelapse" / "timelapse-gif": aspect ratios, length, sizes, overlays. */
  timelapse?: import("./timelapse").TimelapseExportOptions;
  /** "construction": also a dark-paper variant. */
  construction?: { dark?: boolean };
}

export interface ExportedFile {
  name: string;
  bytes: number;
}

export type ServerMsg =
  | {
      t: "hello";
      doc: DocT;
      docs: DocMeta[];
      canUndo: boolean;
      canRedo: boolean;
      agent: AgentStatus;
      projectDir: string;
      version: string;
      timeline: Timeline;
    }
  | { t: "doc"; doc: DocT; canUndo: boolean; canRedo: boolean; author: "user" | "agent"; label: string; reqId?: string; timeline: Timeline }
  | { t: "docs"; docs: DocMeta[] }
  | { t: "agent"; agent: AgentStatus }
  | { t: "ack"; reqId: string; ok: boolean; error?: string; created?: string[] }
  | { t: "request"; id: string; kind: "render"; params: RenderParams }
  | { t: "request"; id: string; kind: "export"; params: ExportParams }
  /** Glyph-by-glyph outlines of a text (lettering) with the fonts the canvas uses. */
  | { t: "request"; id: string; kind: "glyphs"; params: import("./lettering").GlyphsParams }
  /** The logo rendered on an application scene (see mockups.ts). */
  | { t: "request"; id: string; kind: "mockup"; params: import("./mockups").MockupParams }
  /** Font facts and alternate outlines read from the font files in the browser (type controls). */
  | { t: "request"; id: string; kind: "type"; params: import("./type-schema").TypeRequest }
  /** The version in every palette combination, as one contact sheet (see colorways.ts). */
  | { t: "request"; id: string; kind: "colorways"; params: import("./colorways").ColorwaysParams }
  | { t: "focus"; ids: string[] }
  | { t: "chat"; chat: import("./chat").ChatState };

export type ClientMsg =
  | { t: "ops"; ops: OpT[]; label?: string; reqId?: string }
  | { t: "undo" }
  | { t: "redo" }
  | { t: "select"; ids: string[]; frame?: string | null }
  | { t: "goto"; index: number }
  | { t: "view"; mode: ViewMode }
  | { t: "open"; id: string }
  | { t: "create"; name?: string }
  | { t: "response"; id: string; ok: boolean; data?: unknown; error?: string }
  | { t: "chat"; text: string; frame?: string | null; selection?: string[]; variants?: number; images?: string[]; runner?: import("./chat").ChatRunnerKind }
  | { t: "chat-stop" }
  | { t: "chat-clear" }
  | { t: "chat-runner"; runner: import("./chat").ChatRunnerKind; connect?: boolean };

export interface RenderResponse {
  /** Base64 PNG (no data: prefix). */
  png: string;
  width: number;
  height: number;
}

export interface ExportResponse {
  dir: string;
  files: ExportedFile[];
}
