/**
 * Canvas chat: the user types a request in the studio and their own AI CLI
 * (Claude Code, Codex…) runs headless with only Brusshy's tools — or, without
 * a CLI, the request waits in a queue for the AI client that is connected.
 */

export type ChatRunnerKind = "claude" | "codex" | "queue";

export interface ChatRunner {
  kind: ChatRunnerKind;
  label: string;
  available: boolean;
  /** Why it can't run (not installed…). */
  hint?: string;
  /** Installed, but the user hasn't said they want it here yet: ask first. */
  askConnect?: boolean;
}

/** One tool call of a running request, shown live as a progress step. */
export interface ChatStep {
  id: string;
  tool: string;
  label: string;
  at: number;
  /** ms the step took, once done. */
  ms?: number;
  done?: boolean;
  error?: boolean;
}

/** An image the user pasted or dropped into the chat (stored by the daemon, shown to the AI via get_chat_images). */
export interface ChatImage {
  id: string;
  mime: string;
  w?: number;
  h?: number;
}

/**
 * Chat image limits: the studio downsizes and re-encodes before upload (drops metadata); the daemon re-checks.
 * 3.75 MB stays under the 5 MB per image an AI accepts once base64-encoded; 1568 px is the size models read at.
 */
export const CHAT_IMAGES = { max: 4, bytes: 3_932_160, side: 1568 } as const;

export interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
  /** Version the request was about. */
  frame?: string;
  /** Selected layers when the request was sent. */
  selection?: string[];
  /** Asked for N variants side by side. */
  variants?: number;
  /** Images attached to a user message. */
  images?: ChatImage[];
  runner?: ChatRunnerKind;
  status?: "queued" | "running" | "done" | "error" | "stopped";
  steps?: ChatStep[];
  /** Total run time once finished. */
  ms?: number;
}

export interface ChatState {
  runners: ChatRunner[];
  runner: ChatRunnerKind;
  messages: ChatMsg[];
  busy: boolean;
}

/** Friendly progress labels for tool calls (bare tool names, without the MCP prefix). */
export const STEP_LABELS: Record<string, string> = {
  open_studio: "Opening the canvas",
  get_design_guide: "Reading the design guide",
  get_document: "Looking at the document",
  get_selection: "Reading your selection",
  get_sketch: "Reading your sketch",
  get_brand_context: "Reading brand files",
  get_annotations: "Reading your notes",
  get_chat_requests: "Reading your request",
  get_chat_images: "Looking at your images",
  set_svg: "Drawing",
  apply_ops: "Refining shapes",
  deform_path: "Bending a path",
  apply_style: "Applying a 3D style",
  render_preview: "Checking the result",
  duplicate_frame: "Duplicating a version",
  new_frame: "Starting a new version",
  make_variants: "Laying out variants",
  resolve_annotation: "Answering a note",
  export: "Exporting files",
  undo: "Undoing",
  redo: "Redoing",
  history: "Reading the history",
  goto_history: "Jumping in history",
  continue_variant: "Keeping a variant",
  reply_chat: "Replying",
  set_animation: "Animating",
  preview_animation: "Watching the animation",
  check_small_sizes: "Checking small sizes",
  get_style_profile: "Reading the style",
  match_palette: "Matching the palette",
  make_lettering: "Making lettering",
  arrange_letters: "Arranging letters",
  render_mockup: "Rendering a mockup",
  vectorize_reference: "Vectorizing the image",
};

export function stepLabel(tool: string): string {
  const bare = tool.split("__").pop() ?? tool;
  return STEP_LABELS[bare] ?? bare.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
