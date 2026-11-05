import { z } from "zod";

/**
 * Structured, optional taxonomy chips for the Brief: mark type, style, shape and mood. The AI
 * reads them in get_document's brief summary; the studio also builds outbound "find
 * references" searches from them (links only — nothing is fetched or copied into the app).
 */

export const TAG_GROUPS = [
  {
    id: "markType",
    label: "Mark type",
    hint: "What kind of logo",
    options: [
      ["symbol-wordmark", "Symbol + wordmark"],
      ["wordmark", "Wordmark"],
      ["symbol", "Symbol"],
      ["monogram", "Monogram"],
      ["emblem", "Emblem / badge"],
      ["mascot", "Mascot"],
    ],
  },
  {
    id: "style",
    label: "Style",
    hint: "How it's drawn",
    options: [
      ["minimal", "Minimal"],
      ["geometric", "Geometric"],
      ["bold", "Bold"],
      ["rounded", "Rounded"],
      ["monoline", "Monoline"],
      ["elegant", "Elegant"],
      ["hand-drawn", "Hand-drawn"],
      ["serif", "Serif"],
      ["script", "Script"],
      ["playful", "Playful"],
      ["vintage", "Vintage / retro"],
      ["3d", "3D"],
      ["gradient", "Gradient"],
      ["outline", "Outline"],
    ],
  },
  {
    id: "shape",
    label: "Shape",
    hint: "What it's built from",
    options: [
      ["letterform", "Letterform"],
      ["abstract", "Abstract"],
      ["negative-space", "Negative space"],
      ["circle", "Circle"],
      ["square", "Square"],
      ["triangle", "Triangle"],
      ["arrow", "Arrow"],
      ["star", "Star"],
      ["wave", "Wave"],
      ["nature", "Nature / plant"],
      ["animal", "Animal"],
      ["human", "Human / face"],
      ["object", "Object"],
      ["shield", "Shield / badge"],
    ],
  },
  {
    id: "mood",
    label: "Mood",
    hint: "How it should feel",
    options: [
      ["modern", "Modern"],
      ["techy", "Techy"],
      ["friendly", "Friendly"],
      ["corporate", "Corporate"],
      ["serious", "Serious"],
      ["energetic", "Energetic"],
      ["calm", "Calm"],
      ["premium", "Premium"],
      ["luxury", "Luxury"],
      ["classic", "Classic"],
    ],
  },
] as const satisfies readonly { id: string; label: string; hint: string; options: readonly (readonly [string, string])[] }[];

export type TagGroupId = (typeof TAG_GROUPS)[number]["id"];

const tagList = z.array(z.string().max(40)).max(16).default([]);

export const BriefTags = z.object({
  markType: tagList,
  style: tagList,
  shape: tagList,
  mood: tagList,
});
export type BriefTagsT = z.infer<typeof BriefTags>;

export const EMPTY_TAGS: BriefTagsT = { markType: [], style: [], shape: [], mood: [] };

/** Label of a tag id within its group (unknown ids are shown as they are). */
export function tagLabel(group: TagGroupId, id: string): string {
  const g = TAG_GROUPS.find((x) => x.id === group);
  const o = g?.options.find(([v]) => v === id);
  return o ? o[1] : id;
}

export const tagCount = (t: BriefTagsT | undefined | null) => (t ? t.markType.length + t.style.length + t.shape.length + t.mood.length : 0);

/** Brief summary lines ("  • Mark type: Monogram"), only for groups with chips. */
export function briefTagLines(t: BriefTagsT | undefined | null): string[] {
  if (!t) return [];
  return TAG_GROUPS.filter((g) => t[g.id].length).map((g) => `  • ${g.label}: ${t[g.id].map((v) => tagLabel(g.id, v)).join(", ")}`);
}

/** Search words for "find references": mark type + style + shape + mood, then "logo". */
export function tagSearchQuery(t: BriefTagsT, max = 4): string {
  const words: string[] = [];
  const word = (g: TagGroupId, v: string) => {
    const l = tagLabel(g, v).toLowerCase();
    return l.split(/\s*[/+]\s*/)[0]!.trim();
  };
  for (const g of ["markType", "style", "shape", "mood"] as const) for (const v of t[g]) if (words.length < max) words.push(word(g, v));
  if (!words.some((w) => /logo|wordmark|monogram|emblem|mascot/.test(w))) words.push("logo");
  return [...new Set(words)].join(" ");
}

/** Public inspiration galleries opened as searches built from the chips (outbound links only). */
export const INSPIRATION_SOURCES: { id: string; label: string; url: (q: string) => string }[] = [
  { id: "dribbble", label: "Dribbble", url: (q) => `https://dribbble.com/search/${encodeURIComponent(q.replace(/\s+/g, "-"))}` },
  { id: "behance", label: "Behance", url: (q) => `https://www.behance.net/search/projects?search=${encodeURIComponent(q)}` },
  { id: "pinterest", label: "Pinterest", url: (q) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}` },
  { id: "google", label: "Google Images", url: (q) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}` },
];
