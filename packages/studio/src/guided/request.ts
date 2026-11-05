import { EMPTY_TAGS, tagLabel, type BoardItemT, type BriefTagsT, type DocT, type OpT, type TagGroupId } from "@brusshy/core";

/**
 * Guided start: three questions on an empty document → the Brief (+ reference board) in one
 * undo step, and one chat request for 4 distinct directions.
 */

export interface GuidedAnswers {
  name: string;
  what: string;
  /** Feel chip ids (FEELS), at most 3. */
  feel: string[];
  /** Optional mark type tag id (brief-tags markType). */
  mark: string | null;
  /** Images uploaded during the guided start (added to the reference board on finish). */
  refs: BoardItemT[];
}

export const MAX_FEEL = 3;
export const DIRECTIONS = 4;

/** "How should it feel?" chips and the brief tag each one maps to. */
export const FEELS: { id: string; label: string; tag: [TagGroupId, string] }[] = [
  { id: "bold", label: "Bold", tag: ["style", "bold"] },
  { id: "minimal", label: "Minimal", tag: ["style", "minimal"] },
  { id: "playful", label: "Playful", tag: ["style", "playful"] },
  { id: "classic", label: "Classic", tag: ["mood", "classic"] },
  { id: "technical", label: "Technical", tag: ["mood", "techy"] },
  { id: "handmade", label: "Handmade", tag: ["style", "hand-drawn"] },
  { id: "luxury", label: "Luxury", tag: ["mood", "luxury"] },
  { id: "friendly", label: "Friendly", tag: ["mood", "friendly"] },
];

const feelLabels = (a: GuidedAnswers) => a.feel.map((id) => FEELS.find((f) => f.id === id)?.label ?? id);

/** "a, b and c" */
export function andList(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** "A small-batch roaster" → "a small-batch roaster" after a dash (acronyms like "AI tools" stay). */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

const isUntitled = (name: string) => !name.trim() || /^untitled/i.test(name.trim());

/** The single `doc` op that writes the answers (brief fields, tags, board, and a name for an untitled logo). */
export function guidedOps(doc: DocT, a: GuidedAnswers): OpT[] {
  const name = a.name.trim();
  const what = a.what.trim().replace(/\.$/, "");
  const brief: Record<string, unknown> = {};
  if (name || what) brief.subject = name && what ? `${name} — ${lowerFirst(what)}` : name || what;
  const feel = feelLabels(a).map((l) => l.toLowerCase());
  if (feel.length && !doc.brief?.style?.trim()) brief.style = `It should feel ${andList(feel)}.`;
  const prev = doc.brief?.tags ?? EMPTY_TAGS;
  const tags: BriefTagsT = { markType: [...prev.markType], style: [...prev.style], shape: [...prev.shape], mood: [...prev.mood] };
  const add = (g: TagGroupId, v: string) => !tags[g].includes(v) && tags[g].push(v);
  for (const id of a.feel) {
    const f = FEELS.find((x) => x.id === id);
    if (f) add(f.tag[0], f.tag[1]);
  }
  if (a.mark) add("markType", a.mark);
  if (JSON.stringify(tags) !== JSON.stringify(prev)) brief.tags = tags;
  const set: Record<string, unknown> = { brief };
  if (name && isUntitled(doc.name)) set.name = name;
  if (a.refs.length) set.board = { items: [...(doc.board?.items ?? []), ...a.refs].slice(0, 12) };
  return [{ op: "doc", set } as OpT];
}

/** The chat request sent when the guided start finishes. */
export function guidedRequestText(a: GuidedAnswers, boardTotal: number): string {
  const name = a.name.trim();
  const what = a.what.trim().replace(/\.$/, "");
  const who = name ? `“${name}”${what ? ` — ${lowerFirst(what)}` : ""}` : what || "my brand";
  const feel = feelLabels(a).map((l) => l.toLowerCase());
  const facts: string[] = [];
  if (feel.length) facts.push(`it should feel ${andList(feel)}`);
  if (a.mark) facts.push(`the mark type is ${tagLabel("markType", a.mark).toLowerCase()}`);
  const parts = [
    `Guided start: design ${DIRECTIONS} distinct logo directions for ${who}.`,
    `I just filled in the brief — read it first with get_document and follow it${facts.length ? ` (${facts.join("; ")})` : ""}.`,
  ];
  if (boardTotal > 0)
    parts.push(`The reference board has ${boardTotal} image${boardTotal === 1 ? "" : "s"}: call get_board and take their technique and feel by role — never copy a mark.`);
  parts.push(
    `Call make_variants with count ${DIRECTIONS} on this empty version, then give each variant its own clearly different idea — a different concept, construction and type treatment — all within the brief.`,
    `Keep every direction simple enough to read at 16 px, render_preview each one, and end with one short line per variant naming its idea.`,
  );
  return parts.join(" ");
}
