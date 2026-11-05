import type { ReactNode } from "react";
import { create } from "zustand";
import { toast } from "../lib/store";

/**
 * Command registry for the ⌘K palette. Any feature adds itself with one line:
 *
 *   registerCommand({ id: "lockup.open", title: "Lockup…", group: "Panels", shortcut: "⇧L", run: openLockup });
 *
 * `when` hides a command while it can't run (no selection, wrong tool…); `hint` is the context
 * shown on the right (a string or a function evaluated when the palette renders). Dynamic lists
 * (versions, layers, documents, history) come from providers that build commands on open.
 */

export interface Command {
  /** Stable id (recents are remembered by id). */
  id: string;
  title: string;
  /** Section in the palette, e.g. "Edit", "View", "Refine". */
  group: string;
  /** Extra words that should find it ("wireframe" for Outlines). */
  keywords?: string[];
  /** Display form, e.g. "⇧⌘C". The palette doesn't bind it — the feature's own handler does. */
  shortcut?: string;
  icon?: ReactNode;
  /** Context shown dimmed next to the title. */
  hint?: string | (() => string | undefined | null);
  /** Available right now? (hidden when false) */
  when?: () => boolean;
  run: () => unknown;
}

/** Builds commands on demand (the palette calls it every time it opens and as the query changes). */
export type CommandProvider = (query: string) => Command[];

interface Registry {
  commands: Command[];
  providers: { id: string; fn: CommandProvider }[];
  /** Bumped on every change, so open palettes refresh. */
  v: number;
}

export const useRegistry = create<Registry>(() => ({ commands: [], providers: [], v: 0 }));

/** Add (or replace, by id) a command. Returns a function that removes it. */
export function registerCommand(cmd: Command): () => void {
  useRegistry.setState((s) => ({ commands: [...s.commands.filter((c) => c.id !== cmd.id), cmd], v: s.v + 1 }));
  return () => useRegistry.setState((s) => ({ commands: s.commands.filter((c) => c !== cmd), v: s.v + 1 }));
}

export function registerCommands(cmds: Command[]): () => void {
  const ids = new Set(cmds.map((c) => c.id));
  useRegistry.setState((s) => ({ commands: [...s.commands.filter((c) => !ids.has(c.id)), ...cmds], v: s.v + 1 }));
  return () => useRegistry.setState((s) => ({ commands: s.commands.filter((c) => !cmds.includes(c)), v: s.v + 1 }));
}

export function registerProvider(id: string, fn: CommandProvider): () => void {
  useRegistry.setState((s) => ({ providers: [...s.providers.filter((p) => p.id !== id), { id, fn }], v: s.v + 1 }));
  return () => useRegistry.setState((s) => ({ providers: s.providers.filter((p) => p.fn !== fn), v: s.v + 1 }));
}

const available = (c: Command) => {
  try {
    return !c.when || c.when();
  } catch {
    return false;
  }
};

/** Every command available right now (static + provided). */
export function allCommands(query = ""): Command[] {
  const { commands, providers } = useRegistry.getState();
  const provided: Command[] = [];
  for (const p of providers) {
    try {
      provided.push(...p.fn(query));
    } catch {
      /* a provider failing must not break the palette */
    }
  }
  return [...commands, ...provided].filter(available);
}

export function hintOf(c: Command): string | undefined {
  try {
    return (typeof c.hint === "function" ? c.hint() : c.hint) ?? undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- recents

const RECENT_KEY = "brusshy:cmd-recent";
const RECENT_MAX = 8;

export function recentIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function remember(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentIds().filter((x) => x !== id)].slice(0, RECENT_MAX)));
  } catch {
    /* storage unavailable */
  }
}

/** Run a command (remembered as recent; errors become a toast). */
export function runCommand(c: Command) {
  remember(c.id);
  try {
    const r = c.run();
    if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch((e: unknown) => toast((e as Error).message ?? String(e), "error"));
  } catch (e) {
    toast((e as Error).message ?? String(e), "error");
  }
}

// ---------------------------------------------------------------- palette open state

export const useCommandPalette = create<{ open: boolean; query: string }>(() => ({ open: false, query: "" }));
export const openCommandPalette = (query = "") => useCommandPalette.setState({ open: true, query });
export const closeCommandPalette = () => useCommandPalette.setState({ open: false });
