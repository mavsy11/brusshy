/**
 * Construction techniques for exploring marks — the catalog behind the studio's Explorer
 * and the MCP `list_techniques` tool. Two families (as trademark catalogs organise them):
 * letter-based treatments (one letter, many treatments) and symbol constructions (one
 * subject, many constructions). The agent copies the *technique*, never a specific mark.
 *
 * Each technique carries a tiny illustrative diagram: our own drawing, as an SVG fragment
 * for a 48×48 viewBox. Paint with `currentColor`; class "soft" = light ink (secondary faces,
 * construction), class "bg" = the paper colour (cuts, inlines, weave gaps).
 */

export type TechniqueKind = "letter" | "symbol";

export interface Technique {
  id: string;
  name: string;
  kind: TechniqueKind;
  /** What it does, in one line. */
  summary: string;
  /** The usual way it goes wrong. */
  watchOut: string;
  /** Typical subjects (symbol constructions). */
  subjects?: string;
  /** How to build it well in Brusshy (tools and order). */
  howTo: string;
  /** Illustrative diagram: SVG fragment in a 48×48 viewBox (see file comment). */
  diagram: string;
}

const S = (d: string, w: number, extra = "") => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}"${extra}/>`;

/** Eight petals around the centre, built with the same rotation the repeat tool uses. */
const petals = Array.from({ length: 8 }, (_, i) => `<ellipse cx="24" cy="13.2" rx="3.4" ry="8" transform="rotate(${i * 45} 24 24)" fill="currentColor"${i % 2 ? ' opacity=".55"' : ""}/>`).join("");

/** A 6×6 cell grid creature (rows top→bottom, 1 = filled cell). */
const pixelCat = ["100001", "110011", "111111", "101101", "111111", "011110"]
  .flatMap((row, r) => [...row].map((c, k) => (c === "1" ? `<rect x="${6 + k * 6}" y="${7 + r * 6}" width="5.2" height="5.2" rx="1" fill="currentColor"/>` : "")))
  .join("");

/** A sun drawn only with parallel lines clipped to a circle. */
const lineSun = [12, 16, 20, 24, 28, 32, 36]
  .map((y) => {
    const h = Math.sqrt(15 * 15 - (y - 24) ** 2);
    return `<path d="M${(24 - h).toFixed(2)} ${y}H${(24 + h).toFixed(2)}" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`;
  })
  .join("");

export const TECHNIQUES: Technique[] = [
  // ---------- letter-based ----------
  {
    id: "stencil",
    name: "Stencil / split",
    kind: "letter",
    summary: "Cut the letter with one or two bars or a diagonal gap.",
    watchOut: "Gaps must be at least the stroke weight or they close up at small sizes.",
    howTo: "Draw the full letter as filled paths, then cut the gaps as real breaks in the outline (no white bars painted on top).",
    diagram: `${S("M22 10.14A14 14 0 0 0 22 37.86", 7)}${S("M26 10.14A14 14 0 0 1 26 37.86", 7)}`,
  },
  {
    id: "modular",
    name: "Modular",
    kind: "letter",
    summary: "Build the letter from repeated units — squares, dots, quarter circles — on a grid.",
    watchOut: "Keep the units few and identical; mixed sizes read as noise.",
    howTo: "Draw one unit, then place copies on a fixed grid (repeat mode grid, or exact positions); never eyeball the spacing.",
    diagram: [0, 1, 2, 3, 4]
      .flatMap((r) => [0, 1, 2].filter((c) => c === 0 || r % 2 === 0).map((c) => `<circle cx="${16 + c * 8}" cy="${8 + r * 8}" r="3.3" fill="currentColor"/>`))
      .join(""),
  },
  {
    id: "monoline",
    name: "Single stroke / monoline",
    kind: "letter",
    summary: "One continuous line of constant weight draws the letter.",
    watchOut: "Joins and terminals decide the quality — keep the weight truly constant.",
    howTo: "Draw the centre line as one path with a stroke and round caps; convert to a filled outline before 3D or export checks.",
    diagram: S("M14 25H34A10 10 0 1 0 31.5 31.6", 3.2, ' stroke-linecap="round" stroke-linejoin="round"'),
  },
  {
    id: "inline",
    name: "Inline / outline",
    kind: "letter",
    summary: "A fine line runs inside the strokes, or only the contour remains.",
    watchOut: "An inline needs a heavy weight; at small sizes it fills in.",
    howTo: "Start from a heavy letter, then add the inline as its own path (or add_effect inline) in the ground colour.",
    diagram: `${S("M15 9V27A9 9 0 0 0 33 27V9", 9)}<path class="bg" d="M15 9V27A9 9 0 0 0 33 27V9" fill="none" stroke-width="2"/>`,
  },
  {
    id: "negative-space",
    name: "Negative space",
    kind: "letter",
    summary: "The letter is the space between shapes, or a symbol hides in a counter.",
    watchOut: "The hidden form must be findable — test that people see it unprompted.",
    howTo: "Draw the positive shapes so their gaps form the letter; keep gaps equal to the stroke weight.",
    diagram: `<rect x="8" y="6" width="32" height="6" rx="1" fill="currentColor"/><rect x="8" y="18" width="13" height="24" rx="1" fill="currentColor"/><rect x="27" y="18" width="13" height="24" rx="1" fill="currentColor"/>`,
  },
  {
    id: "interlock",
    name: "Interlock / ligature",
    kind: "letter",
    summary: "Two letters share strokes or overlap with an over-under weave.",
    watchOut: "Weave crossings must alternate consistently (over, under, over…).",
    howTo: "Draw both letters with the same stroke; cut the 'under' strand at each crossing with a gap of one stroke weight.",
    diagram: `<circle cx="19" cy="24" r="10" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="29" cy="24" r="10" fill="none" stroke="currentColor" stroke-width="4"/><path class="bg" d="M21.59 14.34A10 10 0 0 1 26.07 16.93" fill="none" stroke-width="8"/>${S("M21.59 14.34A10 10 0 0 1 26.07 16.93", 4)}<path class="bg" d="M26.41 33.66A10 10 0 0 1 21.93 31.07" fill="none" stroke-width="8"/>${S("M26.41 33.66A10 10 0 0 1 21.93 31.07", 4)}`,
  },
  {
    id: "fold",
    name: "Fold / ribbon",
    kind: "letter",
    summary: "The letter looks folded from one strip, with a light and a shadow side.",
    watchOut: "Two tones at most, and the fold must follow how paper really bends.",
    howTo: "Draw the strip as separate faces; the face that turns away gets the darker or lighter tone.",
    diagram: `<path class="soft" d="M30 10H39L28 38H19Z"/><path d="M9 10H18L28 38H19Z" fill="currentColor"/>`,
  },
  {
    id: "rotation",
    name: "Rotation / mirror",
    kind: "letter",
    summary: "The letter reads two ways when rotated or reflected (ambigram, rotational symmetry).",
    watchOut: "Test both readings at small size — one of them usually wins.",
    howTo: "Draw half, then complete it with repeat (radial count 2 for 180° symmetry, or mirror) so both halves stay exact.",
    diagram: `<circle class="soft-line" cx="24" cy="24" r="20" fill="none" stroke-width="1.2" stroke-dasharray="2.5 3"/>${S("M15 37V11L33 37V11", 5, ' stroke-linejoin="miter"')}`,
  },
  {
    id: "container",
    name: "Container",
    kind: "letter",
    summary: "The letter sits inside, or is cut out of, a shape (circle, square, shield).",
    watchOut: "The container must add meaning — not just frame the letter.",
    howTo: "Draw the container, then the letter; cut it out (evenodd) rather than painting it in the ground colour.",
    diagram: `<circle cx="24" cy="24" r="17" fill="currentColor"/><path class="bg" d="M19.5 15V33M29 15L20.2 24.4L29 33" fill="none" stroke-width="4.2" stroke-linejoin="round"/>`,
  },
  {
    id: "perspective",
    name: "Perspective / extrusion",
    kind: "letter",
    summary: "Implied 3D: isometric faces or tilted planes.",
    watchOut: "Keep it flat-printable — the front face alone must still read.",
    howTo: "Draw the front face, then the side faces as separate paths in one consistent direction and one lighter tone.",
    diagram: `<path class="soft" d="M12 12L18 6H26L20 12ZM20 12L26 6V24L20 30ZM20 30L26 24H38L32 30ZM32 30L38 24V32L32 38Z"/><path d="M12 12H20V30H32V38H12Z" fill="currentColor"/>`,
  },
  {
    id: "fragmented",
    name: "Fragmented",
    kind: "letter",
    summary: "The letter is assembled from slices, steps or rays.",
    watchOut: "The rhythm of the slices must be even.",
    howTo: "Draw the letter whole, then slice it with equal gaps; or build it from one slice repeated (repeat grid / radial).",
    diagram: S("M33.9 14.1A14 14 0 1 0 33.9 33.9", 8, ' stroke-dasharray="5 2.4"'),
  },
  {
    id: "object-letter",
    name: "Object-letter",
    kind: "letter",
    summary: "The letter is also an object (P = flag or play button, A = mountain).",
    watchOut: "Aim for one clear double reading, not a rebus.",
    howTo: "Find the stroke of the letter that can become the object; draw that part as the object, keep the rest typographic.",
    diagram: `<rect x="12" y="10" width="6" height="28" rx="1" fill="currentColor"/><path d="M21 10L37 19L21 28Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  {
    id: "dot-swap",
    name: "Dot swap",
    kind: "letter",
    summary: "The dot of an i or j (or a period) becomes a small brand element: a spark, leaf, drop, star.",
    watchOut: "One element, in one dot, sized to match the round dot optically; at 16 px it must still read as a dot.",
    howTo: "Set the name with make_lettering, then replace the dot path with the element, centred on the stem; corners look smaller, so go about 10% larger. For every dot at once, Geist Serif's ss02 (square), ss03 (triangle) or ss04 (heart).",
    diagram: `<rect x="20" y="20" width="8" height="20" rx="1" fill="currentColor"/><path d="M24 5L29 11L24 17L19 11Z" fill="currentColor"/>`,
  },

  // ---------- symbol-based ----------
  {
    id: "radial",
    name: "Radial repeat",
    kind: "symbol",
    summary: "3–12 identical petals or rays rotated around a centre.",
    watchOut: "Vary the petal, not the count; the centre must stay clean.",
    subjects: "Flowers, suns, stars, apertures, wheels",
    howTo: "Draw one petal pointing up from the centre, then repeat mode radial (count 3–12, pivot artboard or a point) — exact rotation, one transform per copy.",
    diagram: petals,
  },
  {
    id: "mirror",
    name: "Mirror symmetry",
    kind: "symbol",
    summary: "Draw half, mirror it; break the symmetry once for life.",
    watchOut: "Perfect symmetry can look static — one asymmetric detail helps.",
    subjects: "Faces, birds, insects, crests",
    howTo: "Draw the left half against the axis, then repeat mode mirror (axis vertical) so the halves stay exact; edit the half and update the repeat.",
    diagram: `<path class="soft-line" d="M24 4V44" fill="none" stroke-width="1.2" stroke-dasharray="2 2.5"/><path d="M23 8C14 12 8 22 12 33C15 38 21 38 23 36Z" fill="currentColor"/><path class="soft" d="M25 8C34 12 40 22 36 33C33 38 27 38 25 36Z"/>`,
  },
  {
    id: "circle-construction",
    name: "Circle construction",
    kind: "symbol",
    summary: "Every curve is an arc of a circle from a construction grid.",
    watchOut: "Tangents must meet smoothly; avoid arcs that almost-but-don't touch.",
    subjects: "Animals, leaves, organic forms",
    howTo: "Lay out construction circles first, then draw arcs that sit exactly on them (A commands or circles combined).",
    diagram: `<circle class="soft-line" cx="18.71" cy="18.71" r="16" fill="none" stroke-width="1" stroke-dasharray="2 2"/><circle class="soft-line" cx="29.29" cy="29.29" r="16" fill="none" stroke-width="1" stroke-dasharray="2 2"/><path d="M14 34A16 16 0 0 1 34 14A16 16 0 0 1 14 34Z" fill="currentColor"/>`,
  },
  {
    id: "modular-grid",
    name: "Modular grid",
    kind: "symbol",
    summary: "The subject drawn on a fixed grid of cells (square or rounded).",
    watchOut: "Fixed cell size, few cells — detail belongs to the silhouette, not to extra cells.",
    subjects: "Pixel animals, buildings, abstract patterns",
    howTo: "Draw one cell, repeat it as a grid (repeat mode grid), then delete the cells you don't need.",
    diagram: pixelCat,
  },
  {
    id: "line-based",
    name: "Line-based",
    kind: "symbol",
    summary: "Parallel lines of equal weight and gaps describe the form.",
    watchOut: "Line weight and gaps must survive small sizes — fewer, thicker lines.",
    subjects: "Landscapes, waves, motion, sound",
    howTo: "Draw one line, repeat it (grid, 1 column) with equal gaps, then trim each line to the silhouette.",
    diagram: lineSun,
  },
  {
    id: "positive-negative",
    name: "Positive/negative swap",
    kind: "symbol",
    summary: "Two subjects share one edge (face and vase, bird and leaf).",
    watchOut: "The shared edge carries the idea — it must read from both sides.",
    subjects: "Two subjects that belong together",
    howTo: "Draw the shared edge first as one path, then close it into the two shapes on either side.",
    diagram: `<path d="M8 8H26C20 16 30 20 22 26C16 30 28 36 24 40H8Z" fill="currentColor"/><path class="soft" d="M26 8H40V40H24C28 36 16 30 22 26C30 20 20 16 26 8Z"/>`,
  },
  {
    id: "silhouette-cutout",
    name: "Silhouette + cutout",
    kind: "symbol",
    summary: "A solid silhouette with one meaningful cut.",
    watchOut: "One cut, and it must mean something — not decoration.",
    subjects: "Animals, objects",
    howTo: "Draw the silhouette as one filled path, then cut the detail out as a hole (evenodd or a reversed subpath).",
    diagram: `<path d="M24 6C24 6 38 21 38 30A14 14 0 0 1 10 30C10 21 24 6 24 6Z" fill="currentColor"/><path class="bg" d="M16.5 30A7.5 7.5 0 0 0 24 37.5" fill="none" stroke-width="3" stroke-linecap="round"/>`,
  },
  {
    id: "geometric-reduction",
    name: "Geometric reduction",
    kind: "symbol",
    summary: "Reduce the subject to triangles, circles and squares until only the gesture remains.",
    watchOut: "Stop before it turns generic — keep the one feature that makes it recognisable.",
    subjects: "Any subject",
    howTo: "Block the subject in with primitives (circle, rect, polygon), then merge and trim until it reads in silhouette.",
    diagram: `<path d="M10 38A22 22 0 0 1 32 16V38Z" fill="currentColor"/><circle cx="33" cy="12" r="5" fill="currentColor"/><path d="M37.5 10L44.5 13L37.5 15.5Z" fill="currentColor"/>`,
  },
];

export function listTechniques(kind?: TechniqueKind | null): Technique[] {
  return kind ? TECHNIQUES.filter((t) => t.kind === kind) : TECHNIQUES;
}

export function techniqueById(id: string): Technique | undefined {
  const k = id.trim().toLowerCase();
  return TECHNIQUES.find((t) => t.id === k || t.name.toLowerCase() === k);
}

/** Short name for naming variants ("Stencil / split" → "Stencil"). */
export const techniqueShortName = (t: Technique) => t.name.split(/\s*[/+]\s*/)[0]!.trim();

/** A standalone SVG of a technique's diagram (e.g. for exports or previews outside the studio). */
export function techniqueDiagramSvg(t: Technique, o: { size?: number; ink?: string; soft?: string; paper?: string } = {}): string {
  const ink = o.ink ?? "#0b0c0e";
  const soft = o.soft ?? "#b9bec1";
  const paper = o.paper ?? "#fafbfb";
  const size = o.size ?? 96;
  const css = `.soft{fill:${soft}}.soft-line{stroke:${soft}}.bg{stroke:${paper};fill:none}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" color="${ink}"><style>${css}</style><rect width="48" height="48" fill="${paper}"/>${t.diagram}</svg>`;
}

// ---------- the Explorer's request ----------

export interface ExploreInput {
  /** "letter" = a letter or initials; "subject" = free text (camera, fox…). */
  mode: "letter" | "subject";
  /** The letter/initials or the subject. */
  target: string;
  /** Chosen technique ids (in order). */
  techniques: string[];
  /** How many directions (2–6). */
  count: number;
  /** Name the variants will get (the document's next version, e.g. "V3"), for the naming example. */
  versionName?: string;
}

const LETTERS = "ABCDEFGH";

/**
 * The one precise request the Explorer sends to the canvas chat: make_variants with one
 * technique per variant, each variant named after its technique. Kept under the chat's
 * 4 000-character limit.
 */
export function exploreRequest(input: ExploreInput): string {
  const count = Math.max(2, Math.min(6, Math.round(input.count)));
  const target = input.target.trim().replace(/\s+/g, " ").slice(0, 80);
  const picked = input.techniques.map(techniqueById).filter((t): t is Technique => !!t);
  const what = input.mode === "letter" ? `the letter${target.replace(/\s/g, "").length > 1 ? "s" : ""} “${target}”` : `“${target}”`;
  const lines: string[] = [];
  lines.push(`Explore ${count} directions for ${what} — one construction technique per direction.`);
  lines.push("");
  const choose = picked.length > count;
  if (choose) lines.push(`Techniques to choose from (use the ${count} that suit ${what} best, one per variant):`);
  else if (picked.length) lines.push("Techniques, in variant order:");
  picked.forEach((t, i) => {
    const tag = choose ? "•" : `${LETTERS[i]} ·`;
    lines.push(`${tag} ${t.name} — ${t.summary} Watch out: ${t.watchOut}${t.kind === "symbol" || /repeat/.test(t.howTo) ? ` Build: ${t.howTo}` : ""}`);
  });
  if (picked.length < count) {
    const kind = input.mode === "letter" ? "letter" : "symbol";
    lines.push(`${picked.length ? `For the other ${count - picked.length}` : `For all ${count}`}, pick different techniques from list_techniques (kind "${kind}") that fit ${what}.`);
  }
  lines.push("");
  lines.push("How:");
  lines.push(`1. Read get_document (brief, palette, type system) and get_board if there is a reference board — take their feel, never copy a mark.`);
  lines.push(`2. make_variants count ${count}, blank true. Rename each variant after its technique with apply_ops ({op:"update", id:<frame>, set:{name:"<variant name> · <technique>"}}, e.g. "${input.versionName ?? "V3"} A · ${techniqueShortName(picked[0] ?? TECHNIQUES[0]!)}").`);
  lines.push(`3. Draw each variant with its technique in clean geometry, same scale and centring on every artboard, mono first. Radial, mirror and grid constructions: draw one unit, then the repeat tool (exact copies, never eyeballed).`);
  lines.push(`4. render_preview every variant; fix weak ones before moving on. Then check_small_sizes on the best one.`);
  lines.push(`5. Reply with one line per variant: its technique and the idea.`);
  return lines.join("\n").slice(0, 3900);
}
