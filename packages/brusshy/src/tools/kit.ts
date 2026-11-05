import type { z } from "zod";
import type { DocT, FrameNodeT, OpT } from "@brusshy/core";
import type { DaemonClient } from "../client";

/** Shared helpers handed to every MCP tool module (tools/*.ts). */

export type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export type ToolResult = { content: Content[]; isError?: boolean };

export const text = (t: string): Content => ({ type: "text", text: t });
export const ok = (...content: Content[]): ToolResult => ({ content });
export const fail = (msg: string): ToolResult => ({ content: [text(msg)], isError: true });

export interface McpState {
  doc: DocT;
  selection: string[];
  activeFrame: string;
  studioConnected: boolean;
  docs: { id: string; name: string; file: string }[];
}

export interface ToolKit {
  /** Register a tool. `status` shows in the studio's agent pill while it runs. */
  tool: <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    run: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>,
    status?: string,
  ) => void;
  daemon: () => Promise<DaemonClient>;
  state: () => Promise<McpState>;
  applyOps: (ops: OpT[], label: string) => Promise<{ ok: boolean; created: string[]; error?: string }>;
  /** Frame by id/name, or the user's active frame. Throws with the list of frames if not found. */
  frameFor: (s: McpState, ref?: string) => FrameNodeT;
  busy: (message: string) => Promise<void>;
}
