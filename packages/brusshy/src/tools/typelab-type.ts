import { z } from "zod";
import {
  AXIS_NAMES,
  baselineLetterOps,
  describeTraits,
  EXTRA_FONTS,
  extraFont,
  fontTraits,
  kernLetterOps,
  lettersOf,
  scaleLetterOps,
  scorePairing,
  suggestPairings,
  swapLetterOps,
  applyOps as applyLocal,
  type DocT,
  type FontInfo,
  type LettersResponse,
  type NodeT,
  type OpT,
} from "@brusshy/core";
import { fail, ok, text, type ToolKit } from "./kit";

/**
 * Type controls for the agent: font search, font facts (weights, variable axes, OpenType features,
 * glyph alternates), per-node type settings, the brand type system, and pairing suggestions.
 * Fontsource's public API answers catalog questions from here (plus EXTRA_FONTS, open families not on it yet); facts that live inside the font files
 * (feature names, alternates) and alternate outlines come from the studio (POST /api/type).
 */

const API = "https://api.fontsource.org/v1";
const fid = (family: string) =>
  family
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 64);

interface Meta {
  id: string;
  family: string;
  weights: number[];
  styles: string[];
  variable: boolean;
  category: string;
  license: string;
  subsets?: string[];
}

let catalogP: Promise<Meta[]> | null = null;
const catalog = () =>
  (catalogP ??= fetch(`${API}/fonts`)
    .then((r) => (r.ok ? (r.json() as Promise<Meta[]>) : []))
    .then((all) => all.filter((f) => f.subsets?.includes("latin") && ["sans-serif", "serif", "display", "handwriting", "monospace"].includes(f.category)))
    .then((all) => [...all, ...EXTRA_FONTS.map((x): Meta => ({ id: x.id, family: x.family, weights: x.weights, styles: x.styles, variable: x.variable, category: x.category, license: x.license }))])
    .catch(() => {
      catalogP = null;
      return [] as Meta[];
    }));

const metaCache = new Map<string, Promise<Meta | null>>();
/** Only families that exist in the catalog are looked up: free text from the agent never goes into a URL. */
async function known(family: string): Promise<string | null> {
  const k = fid(family);
  const all = await catalog();
  return k && all.some((f) => f.id === k) ? k : null;
}

function meta(family: string): Promise<Meta | null> {
  const k = fid(family);
  let p = metaCache.get(k);
  const x = extraFont(family);
  if (!p && x) metaCache.set(k, (p = catalog().then((all) => all.find((f) => f.id === x.id) ?? null)));
  if (!p) {
    p = known(family).then((id) => (id ? fetch(`${API}/fonts/${id}`) : null))
      .then((r) => (r?.ok ? (r.json() as Promise<Meta>) : null))
      .catch(() => null);
    metaCache.set(k, p);
  }
  return p;
}
async function axesOf(family: string): Promise<Record<string, { min: number; max: number; default: number }>> {
  const x = extraFont(family);
  if (x) return { ...x.axes };
  try {
    const id = await known(family);
    if (!id) return {};
    const r = await fetch(`${API}/variable/${id}`);
    if (!r.ok) return {};
    const j = (await r.json()) as { axes?: Record<string, { min: string; max: string; default: string }> };
    return Object.fromEntries(Object.entries(j.axes ?? {}).map(([t, a]) => [t, { min: Number(a.min), max: Number(a.max), default: Number(a.default) }]));
  } catch {
    return {};
  }
}

const CURATED = new Set(
  [
    "Geist", "Inter", "Inter Tight", "Manrope", "Space Grotesk", "Bricolage Grotesque", "Syne", "Unbounded", "Montserrat", "Archivo Black", "Bebas Neue", "Oswald",
    "Playfair Display", "Cormorant Garamond", "Instrument Serif", "Geist Serif", "DM Serif Display", "Abril Fatface", "Cinzel", "Rye", "Poiret One", "Limelight", "Righteous",
    "Fredoka", "Baloo 2", "Pacifico", "Lobster", "Space Mono", "Fraunces", "Roboto Flex",
  ].map((f) => f.toLowerCase()),
);

const lockedBy = (doc: DocT, id: string): string | null => {
  for (let n: NodeT | undefined = doc.nodes[id]; n; n = n.parent ? doc.nodes[n.parent] : undefined) if (n.aiLock) return n.name || n.id;
  return null;
};

const AxesArg = z.record(z.string(), z.number()).nullable();
const RoleArg = z.union([
  z.string(),
  z.object({
    family: z.string(),
    weight: z.number().int().min(1).max(1000).optional(),
    axes: z.record(z.string(), z.number()).optional(),
    features: z.array(z.string()).optional(),
    tracking: z.number().optional().describe("1/1000 em"),
  }),
]);

export function registerTypeTools(kit: ToolKit) {
  const { tool, state, applyOps, daemon } = kit;

  async function studioInfo(family: string, chars?: string): Promise<FontInfo | null> {
    try {
      const c = await daemon();
      return await c.call<FontInfo>("POST", "/api/type", { action: "info", family, chars }, 60_000);
    } catch {
      return null;
    }
  }

  tool(
    "list_fonts",
    "Search the font catalog (≈2 000 open-licence families from Fontsource / Google Fonts, plus a few newer open families such as Geist Serif — all free for commercial use) by name and/or category. Returns families with category, weights, whether they are variable, and licence. Curated logo-friendly families come first.",
    {
      query: z.string().optional().describe("Words in the family name, e.g. 'grotesk' or 'serif display'"),
      category: z.enum(["sans-serif", "serif", "display", "handwriting", "monospace"]).optional(),
      limit: z.number().int().min(1).max(100).default(30),
    },
    async ({ query, category, limit }) => {
      const all = await catalog();
      if (!all.length) return fail("The font catalog (api.fontsource.org) is unreachable right now.");
      const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const hits = all
        .filter((f) => !category || f.category === category)
        .filter((f) => words.every((w) => f.family.toLowerCase().includes(w) || f.category.includes(w)))
        .sort((a, b) => Number(CURATED.has(b.family.toLowerCase())) - Number(CURATED.has(a.family.toLowerCase())) || a.family.localeCompare(b.family));
      const lines = hits.slice(0, limit).map((f) => `- ${f.family} — ${f.category}, ${f.variable && f.weights.length > 1 ? `variable (${Math.min(...f.weights)}–${Math.max(...f.weights)})` : `weight${f.weights.length > 1 ? "s" : ""} ${f.weights.join("/")}${f.variable ? ", variable axes" : ""}`}${f.styles.includes("italic") ? ", italic" : ""}, ${f.license}${CURATED.has(f.family.toLowerCase()) ? " ★" : ""}`);
      return ok(text(`${hits.length} famil${hits.length === 1 ? "y" : "ies"}${hits.length > limit ? ` (showing ${limit})` : ""}:\n${lines.join("\n") || "(none)"}\nNext: font_info(family) for axes, OpenType features and glyph alternates; suggest_pairings(family) for a body font.`));
    },
  );

  tool(
    "font_info",
    "Everything a font offers for wordmark craft: weights, italic, variable axes (weight, width, slant, optical size, custom axes like SOFT or GRAD) with ranges and named instances, the OpenType features it really has (stylistic sets with their names, swashes, small caps, oldstyle figures…), and which letters have glyph alternates. Feature and alternate details are read from the full font in the studio (needs it open); catalog facts work without it.",
    {
      family: z.string(),
      chars: z.string().optional().describe("Letters you care about (e.g. the brand name) — alternates are listed for these first"),
    },
    async ({ family, chars }) => {
      const m = await meta(family);
      if (!m) return fail(`"${family}" isn't in the catalog. Use list_fonts to find the exact family name.`);
      const fsAxes = await axesOf(family);
      const info = await studioInfo(m.family, chars);
      const t = fontTraits(m.family, { category: m.category });
      const out = [`${m.family} — ${m.category}, ${m.license}. ${describeTraits(t)}.${extraFont(m.family) ? ` ${extraFont(m.family)!.note}` : ""}`, `Weights: ${m.weights.join(", ")}${m.variable && m.weights.length > 1 ? " (variable: any value in between)" : ""}${m.styles.includes("italic") ? " · has italic (axes {ital: 1})" : ""}.`];
      const axes = info?.axes.length ? info.axes : Object.entries(fsAxes).filter(([t]) => t !== "ital").map(([tag, a]) => ({ tag, name: AXIS_NAMES[tag] ?? tag, ...a }));
      if (axes.length) out.push(`Variable axes: ${axes.map((a) => `${a.tag} "${a.name}" ${a.min}–${a.max} (default ${a.default})`).join("; ")}.`);
      if (info?.instances.length) out.push(`Named instances: ${info.instances.map((i) => i.name).join(", ")}.`);
      if (info) {
        out.push(info.features.length ? `OpenType features: ${info.features.map((f) => `${f.tag} (${f.name})`).join(", ")}.` : "OpenType features: none beyond the basics.");
        const alts = Object.entries(info.alternates);
        if (alts.length) {
          const want = new Set(Array.from(chars ?? ""));
          alts.sort(([a], [b]) => Number(want.has(b)) - Number(want.has(a)));
          out.push(`Glyph alternates (char: keys): ${alts.slice(0, 40).map(([ch, list]) => `${ch}: ${list.slice(0, 5).map((l) => l.key).join(" ")}${list.length > 5 ? ` (+${list.length - 5})` : ""}`).join(" · ")}${alts.length > 40 ? " …" : ""}.`);
        } else out.push("Glyph alternates: none.");
        out.push(`Metrics: x-height ${(info.metrics.xHeight / info.metrics.unitsPerEm).toFixed(3)} em, cap height ${(info.metrics.capHeight / info.metrics.unitsPerEm).toFixed(3)} em. Source: ${info.source}.`);
      } else out.push("(Open the studio for the font's OpenType features and glyph alternates — they're read from the font file.)");
      out.push('Use: set_type(id, {axes:{wght:640, wdth:85}, features:["ss01","-liga"], alternates:{"3":"salt:1"}, kerning:"optical", tracking:40}).');
      return ok(text(out.join("\n")));
    },
  );

  tool(
    "set_type",
    "Fine type settings in one undo step. On a TEXT layer: variable axes (exact outlines from the variable font; wght also sets the weight), OpenType features (\"ss01\" on, \"-liga\" off; replaces the list), per-character glyph alternates ({charIndex: \"feature:n\"}, \"\" = default), kerning mode (metric = the font's pairs, optical = from the shapes, manual = none), manual pair kerning (kerns[i] = 1/1000 em after char i) and tracking (1/1000 em). On a LETTERING group (make_lettering): alternates ({letterIndex or letterId: key}) swap letters' outlines in place, and letters:[{letter, kern, baseline, scale}] nudge single letters (kern/baseline in artboard units, kern moves the letter and everything after it; baseline negative = up; scale absolute). Pass null to clear axes/features/alternates/kerns.",
    {
      id: z.string().describe("Text node or lettering group id"),
      axes: AxesArg.optional(),
      features: z.array(z.string()).nullable().optional(),
      alternates: z.record(z.string(), z.string()).nullable().optional(),
      kerning: z.enum(["metric", "optical", "manual"]).optional(),
      kerns: z.array(z.number()).nullable().optional(),
      tracking: z.number().optional().describe("Text only: letter spacing in 1/1000 em"),
      letters: z
        .array(z.object({ letter: z.union([z.number().int(), z.string()]), kern: z.number().optional(), baseline: z.number().optional(), scale: z.number().positive().optional() }))
        .optional()
        .describe("Lettering groups only"),
    },
    async (a) => {
      const s = await state();
      const n = s.doc.nodes[a.id];
      if (!n) return fail(`Node ${a.id} not found`);
      const lock = lockedBy(s.doc, a.id);
      if (lock) return fail(`${a.id} is locked for the AI (${lock}) — ask the user before changing it.`);

      if (n.type === "text") {
        if (a.letters) return fail("letters:[…] is for lettering groups; on text use kerns (1/1000 em) and alternates.");
        const set: Record<string, unknown> = {};
        const notes: string[] = [];
        const info = a.features?.length || (a.alternates && Object.keys(a.alternates).length) || a.axes ? await studioInfo(n.fontFamily, n.text) : null;
        if (a.axes !== undefined) {
          if (a.axes === null) set.axes = null;
          else {
            const ranges = info?.axes.length ? Object.fromEntries(info.axes.map((x) => [x.tag, x])) : await axesOf(n.fontFamily);
            const axes: Record<string, number> = {};
            for (const [tag, v] of Object.entries(a.axes)) {
              if (tag === "ital") {
                axes.ital = v >= 0.5 ? 1 : 0;
                continue;
              }
              const r = ranges[tag];
              if (!r) return fail(`${n.fontFamily} has no "${tag}" axis${Object.keys(ranges).length ? ` (it has ${Object.keys(ranges).join(", ")})` : " — it isn't a variable font; use fontWeight"}.`);
              const c = Math.min(r.max, Math.max(r.min, v));
              if (c !== v) notes.push(`${tag} clamped to ${c}`);
              axes[tag] = c;
            }
            set.axes = axes;
            if (axes.wght !== undefined) set.fontWeight = Math.min(900, Math.max(100, Math.round(axes.wght / 100) * 100));
          }
        }
        if (a.features !== undefined) {
          if (a.features && a.features.some((f) => !/^-?[a-z0-9]{4}$/i.test(f))) return fail('Features are 4-letter tags like "ss01", "swsh", "smcp", "onum", or "-liga" to turn a default off.');
          if (info && a.features) {
            const have = new Set(info.features.map((f) => f.tag));
            const missing = a.features.filter((f) => !f.startsWith("-") && !have.has(f) && !["liga", "calt", "clig", "kern"].includes(f));
            if (missing.length) notes.push(`${n.fontFamily} doesn't have ${missing.join(", ")} (ignored when rendering)`);
          }
          set.features = a.features && a.features.length ? a.features : null;
        }
        if (a.alternates !== undefined) {
          if (a.alternates) {
            const chars = Array.from(n.text);
            for (const [k, v] of Object.entries(a.alternates)) {
              const i = Number(k);
              if (!Number.isInteger(i) || i < 0 || i >= chars.length) return fail(`Alternate key "${k}" must be a character index 0–${chars.length - 1} of "${n.text}".`);
              if (v && info) {
                const list = info.alternates[chars[i]!] ?? [];
                if (!list.some((l) => l.key === v || l.key === `${v}:1`)) return fail(`"${chars[i]}" has no alternate "${v}" in ${n.fontFamily}${list.length ? ` (it has ${list.map((l) => l.key).join(", ")})` : " (it has none)"}.`);
              }
            }
            set.alternates = a.alternates;
          } else set.alternates = null;
        }
        if (a.kerning) set.kerning = a.kerning === "metric" ? null : a.kerning;
        if (a.kerns !== undefined) set.kerns = a.kerns && a.kerns.some((k) => k) ? a.kerns : null;
        if (a.tracking !== undefined) set.letterSpacing = Math.round((a.tracking / 1000) * n.fontSize * 100) / 100;
        if (!Object.keys(set).length) return fail("Nothing to change — pass axes, features, alternates, kerning, kerns or tracking.");
        const r = await applyOps([{ op: "update", id: a.id, set }], `Type: ${Object.keys(set).join(", ")}`);
        if (!r.ok) return fail(r.error ?? "Failed");
        return ok(text(`Updated "${n.name || n.text}" (${a.id}): ${Object.entries(set).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}.${notes.length ? ` Notes: ${notes.join("; ")}.` : ""} Check it with render_preview.`));
      }

      if (n.type !== "group" || lettersOf(s.doc, a.id).length < 2) return fail(`${a.id} is a ${n.type}. set_type works on text layers and lettering groups (make_lettering).`);
      if (a.axes !== undefined || a.features !== undefined || a.kerning || a.kerns !== undefined || a.tracking !== undefined)
        return fail("A lettering group is outlines now: axes/features/kerning apply to text. Set them on the text before make_lettering, or use alternates / letters here.");
      let doc = s.doc;
      const ops: OpT[] = [];
      const letters = lettersOf(doc, a.id);
      const indexOf = (ref: number | string) => (typeof ref === "number" ? ref : Number.isInteger(Number(ref)) ? Number(ref) : letters.findIndex((l) => l.id === ref));
      const done: string[] = [];
      if (a.alternates && Object.keys(a.alternates).length) {
        if (n.lettering == null) return fail("This lettering was made before Brusshy remembered its font, so its glyph alternates can't be looked up. Re-make it from text (make_lettering) to use alternates.");
        const picks = Object.entries(a.alternates).map(([ref, key]) => {
          const i = indexOf(ref);
          return { letter: i, key, current: (doc.nodes[letters[i]?.id ?? ""] as { d?: string } | undefined)?.d };
        });
        const bad = picks.find((p) => p.letter < 0 || p.letter >= letters.length);
        if (bad) return fail(`Letter ${JSON.stringify(Object.keys(a.alternates)[picks.indexOf(bad)])} not found — use 0–${letters.length - 1} or a letter id.`);
        let r: LettersResponse;
        try {
          r = await (await daemon()).call<LettersResponse>("POST", "/api/type", { action: "letters", source: n.lettering, picks }, 60_000);
        } catch (e) {
          return fail((e as Error).message);
        }
        for (const l of r.letters) {
          const id = letters[l.letter]!.id;
          const sw = swapLetterOps(doc, id, l.d);
          ops.push(...sw);
          doc = applyLocal(doc, sw).doc;
          done.push(`${l.text} → ${a.alternates[Object.keys(a.alternates).find((k) => indexOf(k) === l.letter)!] || "default"}`);
        }
      }
      for (const L of a.letters ?? []) {
        const i = indexOf(L.letter);
        const lid = lettersOf(doc, a.id)[i]?.id;
        if (!lid) return fail(`Letter ${JSON.stringify(L.letter)} not found — use 0–${letters.length - 1} or a letter id.`);
        const step = [...(L.kern ? kernLetterOps(doc, lid, L.kern) : []), ...(L.baseline ? baselineLetterOps(doc, lid, L.baseline) : [])];
        doc = applyLocal(doc, step).doc;
        const sc = L.scale ? scaleLetterOps(doc, lid, L.scale) : [];
        doc = applyLocal(doc, sc).doc;
        ops.push(...step, ...sc);
        done.push(`${doc.nodes[lid]?.name}: ${[L.kern ? `kern ${L.kern}` : "", L.baseline ? `baseline ${L.baseline}` : "", L.scale ? `scale ${L.scale}` : ""].filter(Boolean).join(", ")}`);
      }
      if (!ops.length) return fail("Nothing to change — pass alternates or letters.");
      const r = await applyOps(ops, "Letters");
      if (!r.ok) return fail(r.error ?? "Failed");
      return ok(text(`Lettering "${n.name}" (${a.id}), one undo step: ${done.join("; ")}. Layouts (arrange_letters) keep these edits. Check with render_preview.`));
    },
    "Setting type…",
  );

  const roleOf = async (r: z.infer<typeof RoleArg>, fallbackWeight: number) => {
    const o = typeof r === "string" ? { family: r } : r;
    const m = await meta(o.family);
    if (!m) throw new Error(`"${o.family}" isn't in the catalog — use list_fonts for exact names.`);
    const weight = o.weight ?? (m.weights.includes(fallbackWeight) ? fallbackWeight : m.weights.reduce((a, b) => (Math.abs(b - fallbackWeight) < Math.abs(a - fallbackWeight) ? b : a)));
    if (!m.variable && !m.weights.includes(weight)) throw new Error(`${m.family} comes in ${m.weights.join(", ")} — ${weight} isn't one of them.`);
    return { family: m.family, weight, category: m.category, ...(o.axes ? { axes: o.axes } : {}), ...(o.features ? { features: o.features } : {}), ...(o.tracking !== undefined ? { tracking: o.tracking } : {}) };
  };

  tool(
    "set_type_system",
    "Save the brand's type system: the heading/wordmark font and the body font (family or {family, weight, axes, features, tracking}). The user sees it in the studio (Fonts dialog, Brand fonts in the Type panel) and applies it in one click; get_document shows it. One undo step. Pick with suggest_pairings.",
    {
      heading: RoleArg,
      body: RoleArg.optional(),
      sample: z.string().optional().describe("Word to preview with (usually the brand name)"),
      note: z.string().optional().describe("Why this pairing, in one line"),
    },
    async ({ heading, body, sample, note }) => {
      const s = await state();
      try {
        const h = await roleOf(heading, 600);
        const b = body ? await roleOf(body, 400) : undefined;
        const score = b ? scorePairing(fontTraits(h.family, { category: h.category }), fontTraits(b.family, { category: b.category })) : null;
        const sys = { heading: h, ...(b ? { body: b } : {}), sample: sample ?? s.doc.typeSystem?.sample ?? s.doc.name, note: note ?? (score ? score.reasons.slice(0, 2).join("; ") : "") };
        const r = await applyOps([{ op: "doc", set: { typeSystem: sys }, replace: true }], `Type system: ${h.family}${b ? ` + ${b.family}` : ""}`);
        if (!r.ok) return fail(r.error ?? "Failed");
        return ok(text(`Type system saved: heading ${h.family} ${h.weight}${b ? `, body ${b.family} ${b.weight}` : ""}.${score ? ` Pairing score ${score.score}: ${[...score.reasons, ...score.warnings.map((w) => `⚠ ${w}`)].join("; ")}.` : ""}`));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  tool(
    "suggest_pairings",
    "Offline font pairing: for a heading family suggest body fonts (or, with role \"body\", headings for a body font), scored on contrast of classification (serif × sans…), x-height compatibility (measured from the fonts), era/mood and stroke contrast — each with reasons and warnings.",
    {
      family: z.string(),
      role: z.enum(["heading", "body"]).default("heading").describe("What `family` is in the pair"),
      limit: z.number().int().min(1).max(12).default(6),
    },
    async ({ family, role, limit }) => {
      const m = await meta(family);
      const list = suggestPairings(m?.family ?? family, { role, limit, traits: { category: m?.category } });
      const me = fontTraits(m?.family ?? family, { category: m?.category });
      const lines = list.map((p) => `- ${role === "heading" ? p.body : p.heading} (score ${p.score}): ${[...p.reasons.slice(0, 3), ...p.warnings.map((w) => `⚠ ${w}`)].join("; ")}`);
      return ok(text(`${m?.family ?? family}: ${describeTraits(me)}.\n${role === "heading" ? "Body fonts" : "Heading fonts"} that pair well:\n${lines.join("\n")}\nSave the choice with set_type_system.`));
    },
  );

}
