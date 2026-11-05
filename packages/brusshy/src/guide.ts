/** Design knowledge shipped with the MCP server, so any agent designs well without a separate skill. */

export const INSTRUCTIONS = `Brusshy is a logo studio. The user watches a live canvas in their browser while you design.

Workflow:
1. Call open_studio once so the user sees the canvas (it also starts Brusshy if needed).
2. Read context: get_document (it starts with the user's Brief — read it and follow it: subject, use, style, palette, typography, what to keep and what to avoid), get_brand_context (brand files the user dropped), get_sketch if they drew something or added reference images, get_selection if they point at a part.
3. Design with set_svg (write clean SVG in artboard coordinates; it becomes editable nodes) and refine with apply_ops (precise edits: move, recolor, reshape, extrude settings).
4. ALWAYS look at your work with render_preview (2D, and 3D when relevant) before saying you are done, and run check_small_sizes once before you finish. Iterate until it is genuinely good.
5. The user leaves notes pinned on parts of the logo. Use watch_annotations / get_annotations, apply the change, then resolve_annotation with a short reply.
6. Export only when asked (export tool).

Versions: the canvas holds several versions side by side (frames V1, V2…). Tools act on the active frame (the one the user is working in) unless you pass frame=<id or name>. To explore a variant, duplicate_frame and edit the copy — never overwrite a version the user didn't ask you to change. To compare several directions at once, make_variants lays them out side by side (V3 A, V3 B…); the user picks one with "Continue with this".

The user can also type requests in the canvas chat: watch_annotations wakes up for them too (or call get_chat_requests); answer with reply_chat. If the user pasted images with the request, get_chat_images shows them (references only).

Parts marked (ai-locked) in get_document were locked by the user for you: never change, move or delete them (or anything inside them) — design around them. Edits to them are refused.

The user edits by hand too. Tool results tell you what they changed since your last action: treat those edits as decisions — keep them, build on them, and don't revert or redraw those parts unless asked.

If the user has their own design skills or brand guidelines (in their AI client or in brusshy/brand/), follow them; they override the generic recipes here.

Animation: set_animation gives a version an entrance and an optional subtle loop; check it with preview_animation (get_design_guide topic "animation").

Color: the brand palette (get_document lists it) is the user's color spec. generate_palette / set_palette build it, make_colorways shows the logo in every palette combination (get_design_guide topic "palette").

Type: the brand type system (heading + body fonts) is in get_document; font_info / set_type give variable axes, OpenType features, glyph alternates and kerning (get_design_guide topic "type").

Critique: when the user asks for feedback or a review, call critique — measured checks plus a marked render; add your own judgement (concept fit, originality) and pin the actionable findings as canvas notes instead of changing the design.

Exploring: list_techniques is the catalog of construction techniques (letter treatments and symbol constructions); run one letter or subject through several with make_variants, one technique per variant, named after it. Radial, mirror and grid constructions: draw one unit, then repeat (exact copies, rebuildable after you edit the source). If get_document mentions a reference board, call get_board: take the technique and feel, never copy a mark.

Call get_design_guide before your first design in a session.`;

export const GUIDE: Record<string, string> = {
  principles: `# Logo design principles

- **One idea.** A great mark expresses a single concept. Remove anything that does not serve it.
- **Works at 16px.** Check a tiny render: if details vanish or blur, simplify. Avoid hairlines thinner than ~2% of the artboard.
- **Silhouette first.** It must read as a solid black shape (mono) before color, gradients or 3D.
- **Geometry with optical correction.** Build on circles, grids and consistent angles, then correct optically: round shapes overshoot ~2–3% to look the same size as squares; horizontal strokes slightly thinner than vertical ones.
- **Consistent stroke and corner language.** Pick one stroke weight and one corner radius family and reuse them.
- **Negative space is a feature.** The best marks often hide a second reading in the counter-forms.
- **Balance.** Visual center sits slightly above the geometric center. Leave clear space; center the mark on the artboard with ~12–18% margin.
- **Limited palette.** 1–3 colors. Gradients only when the style calls for it; the mark must still work flat.
- **Wordmarks.** Use real fonts via text nodes (they are outlined on export). Tune letter-spacing: logos often need tighter tracking for heavy weights, wider for caps.
- **3D-ready.** Closed, non-self-intersecting shapes extrude cleanly. Avoid open strokes for parts that should be 3D (convert to filled outlines).

## SVG craft for Brusshy
- Coordinates are artboard units (default 1024×1024, origin top-left).
- Prefer \`<path>\` with clean cubic curves; use \`<circle>\`/\`<rect rx>\` for primitives (they become editable shapes).
- Give meaningful \`id\`s (e.g. id="needle", id="ring"): they become layer names and help the user point at parts.
- Group related parts with \`<g id="...">\`.
- Name the symbol group \`id="icon"\` (or "mark"/"symbol"): favicon and app-icon exports use only that part. Without it, icons use everything except top-level text.
- Use fill-rule="evenodd" for shapes with holes, or draw holes as reversed subpaths.`,

  workflow: `# Working with the user

- Start by asking yourself: what is the one idea? Then sketch 2–3 distinct directions only if the user asked for options; otherwise commit to the strongest one.
- If the user drew a sketch (get_sketch), treat it as intent, not as final geometry: keep its composition and proportions, clean the curves, fix symmetry.
- If there is a reference image layer, trace its *structure* with clean geometry; never copy a third-party logo.
- For a photo of the user's own sketch or an old logo file: vectorize first (vectorize_reference — mode "lines" for pencil sketches, "shapes" + colors for flat artwork), then simplify and correct by hand: delete stray bits, merge parts, straighten and symmetrize, swap wobbly curves for clean geometry. The trace is a starting outline, not the final logo.
- For a photo of a real object (a mug, a pet, a product, a hand-painted sign): vectorize_reference mode "photo" cuts the subject out of its background offline and draws it as style "silhouette" (most logo-ready), "posterized" (tones), "lineart" or "stencil". Preview first with apply=false (it shows the detected subject): if the background was kept or parts are missing, adjust tolerance, subject darker/lighter, crop, fill_holes or keep, then apply. The result is raw material: simplify it, then design the actual mark on top in clean geometry — exaggerate what makes the object recognizable, drop the rest.
- To judge the logo in context (real sizes, real surfaces), use render_mockup (app-icon and browser-tab expose weak small-size legibility).
- After each meaningful change, render_preview and critique it honestly (balance, weight, legibility at small sizes). Fix before reporting.
- Cleanup passes are exact and cost no drawing: refine (simplify / smooth after vectorizing, symmetric to fix near-symmetry, bolder / thinner for weight, round for corners, optical-center to balance a mark in its artboard, snap-grid for crisp coordinates).
- Keep the layer tree tidy: named groups, no stray empty nodes, sketches/references can stay (they are never exported).
- For 3D: set scene/material with apply_style or apply_ops (doc.scene, node.extrude). Use z offsets to layer parts; give thin details less depth.
- Resolve every annotation you act on with a one-line reply describing what changed.

## The brief
- get_document shows the user's Brief first. It is the spec: honor every filled field. "Must keep" items are non-negotiable; "Avoid" items are hard no's. If a field conflicts with a later chat request, the chat request wins — mention the conflict in one line.
- An empty brief means: ask yourself the same questions (subject, where it's used, style, palette, type) before drawing.

## Locks for the AI
- (ai-locked) parts are decisions the user made. Keep them pixel-identical; build the rest around them (match their stroke weight, corners and colors). To redo the whole logo, put the new drawing in a duplicate_frame copy and leave locked parts as they are.

## Reference images have roles (see get_sketch)
- reference — general reference: trace the structure with clean geometry; never copy a third-party logo.
- palette — take only the colors (1–3 dominant ones, sampled from the image); ignore its shapes.
- silhouette — match the outer shape and proportions; ignore its colors and inner details.
- style — match the rendering language (stroke weight, corners, texture, era); not its subject or layout.

## Exploring techniques and the reference board
- list_techniques gives the catalog: letter treatments (stencil, modular, monoline, inline, negative space, interlock, fold, rotation, container, perspective, fragmented, object-letter) and symbol constructions (radial, mirror, circle construction, modular grid, line-based, positive/negative swap, silhouette + cutout, geometric reduction). To explore: make_variants (blank), one technique per variant, rename each variant "<name> · <technique>", same scale and centring everywhere, then keep the 2–3 that carry the idea.
- Exact construction: draw one unit, then repeat — radial (petals, rays, apertures: vary the petal, not the count), mirror (draw half against the axis) or grid (modules, pixel marks, parallel lines). The group keeps the recipe: edit the source and call repeat with ids=[group] to rebuild, or pass new count/angle/pivot.
- The reference board (get_board) holds the user's inspiration images with roles and notes. Take techniques, proportions, colour relationships and era — never trace or copy a mark from it. The brief's chips (mark type, style, shape, mood) are part of the spec.

## Construction (grid-built marks)
- Build with a grid, don't decorate with one: add_construction (circle-grid on one ratio — golden 1.618, 2 or 1.5 —, radial for flowers/suns/apertures, keylines for icon sets, square/diagonal grid for modular marks, or your own circles). Guides live on the version, are never exported, and the result lists every circle.
- Shapes come from the regions between intersecting circles: fill_region with one point inside each region (merge=true fuses neighbours into one path; subtract=true cuts a region out of a shape). Edges are the exact arcs and lines of the guides, with sharp tips.
- Clean up with boolean (union / subtract / intersect / exclude / divide — curves stay true arcs), then check with render_preview and check_small_sizes.
- When the mark is final, clear_construction — or keep it and export ["construction"]: the construction sheet (hatched regions, ratio labels, clean mark beside it) is for presentations only; the logo ships clean.

## Small sizes
- Before saying you are done, call check_small_sizes: the mark must read at 16 px on light and dark. Thicken or remove hairlines, open counters that fill in, and keep text out of the icon if it turns to mush. A high-contrast mark (critique: "needs a small-size cut") gets its own small version: duplicate_frame, then thicken only the thin strokes.`,

  styles: `# Style recipes

**Modern / tech** — geometric primitives, 1 bold color + neutral, generous negative space, rounded 8–15% corners, tight-tracked geometric sans (Geist, Inter, Manrope); Geist Serif for an editorial wordmark that sits with Geist on one line. 3D: soft-plastic or glossy-enamel, studio light.

**Minimal Swiss** — pure geometry, grid-locked, black/white + one accent, no gradients, Helvetica-like grotesk (Inter Tight). 3D: ceramic or flat lighting.

**Luxury** — thin elegant strokes, high contrast serif (Playfair Display, Cormorant), monogram or crest, black + gold/cream. 3D: gold or brushed-metal, golden-hour light, dark background.

**1800s / Victorian / heritage** — engraved feel, emblem/badge shapes, ribbons, ornamental borders, star and laurel motifs, slab or Didone serifs (Abril Fatface, Rye for western), muted inks (oxblood, forest, navy, cream). Simulate engraving with parallel line hatching paths. 3D: copper/gold, golden-hour.

**Rustic / craft** — hand-made imperfection (slightly irregular curves), stamps and badges, earthy palette (terracotta, olive, kraft), sturdy serif or hand lettering. 3D: stone or copper.

**Art deco** — symmetry, sunbursts, stepped forms, fan motifs, gold on black/emerald, geometric display type (Poiret One, Limelight). 3D: gold + dramatic.

**Retro 70s** — chunky rounded type (Cooper-like), stacked stripes, warm oranges/browns/mustard, soft drop shadows. 3D: glossy-enamel.

**Metallic / industrial** — bold angular forms, chamfers, stencil cuts, gray scale. 3D: brushed-metal or chrome, dramatic light.

**Playful** — bouncy rounded shapes, mascots built from circles, saturated palette, heavy rounded type (Fredoka, Baloo). 3D: soft-plastic, studio.

**Futuristic / web3** — gradients, iridescence, crisp geometric glyphs, monoline. 3D: iridescent or clear-glass, night/studio.

**Neon** — monoline strokes with round caps (draw as filled outlines for 3D), bright saturated colors on dark. 3D: neon material, night lighting, bloom ~1.2.`,

  series: `# Building a consistent series (icon sets, horizontal / stacked / isotype variants)

- **Read the source first.** get_style_profile(frame) gives the palette with area shares, stroke weight, corner radius, curve character, symmetry, fonts and margins. Treat it as the spec for every new piece.
- **One new version per piece.** new_frame (or duplicate_frame for variants of the same logo) and draw there; never overwrite the source.
- **Same stroke weight, optically.** Keep the profile's stroke weight relative to the mark (e.g. 6% of the mark height) on every icon. At small sizes go ~5–10% heavier so they *look* the same weight.
- **Same corner family.** Reuse the corner radius ratio (radius ÷ the shape's smaller side), not the absolute number, when a piece is bigger or smaller.
- **Same curve character.** If the source is soft curves, avoid sharp-cornered newcomers (and vice versa). Keep cap and join styles identical.
- **Same palette and proportions.** Use only the source colors, with the dominant color still dominant. match_palette(source_frame, target_frame) recolors a finished piece in one step.
- **Optical sizing.** Pieces in a set share a visual size, not a bounding box: circles and diagonal shapes slightly larger than squares; dense icons slightly smaller. Keep the same margins (clear space) from the profile.
- **Horizontal vs stacked vs isotype.** Isotype = the symbol alone (name it id="icon"). Horizontal: symbol left, wordmark right, symbol height ≈ cap height × 1.4–2, gap ≈ 0.5× symbol width. Stacked: symbol above, centered wordmark, gap ≈ 0.25–0.35× symbol height.
- **Check them together.** render_preview each piece, then compare with get_style_profile on the new version: palette, stroke and symmetry should read the same.`,

  type: `# Wordmark type craft (list_fonts, font_info, set_type, suggest_pairings, set_type_system)

- **Choose deliberately.** Shortlist 3–5 families that fit the brief (list_fonts by category), then font_info(family, chars=brand name) to see weights, variable axes, stylistic sets and which letters have alternates. Read the Type system line in get_document first — if the user saved brand fonts, use them.
- **Spacing first.** Default tracking is drawn for paragraphs, not logos. Caps wordmarks almost always want positive tracking (+40…+120 per 1000 em); lowercase wordmarks usually want tighter (−10…−30) and optical kerning (set_type kerning "optical"). Then fix the worst pairs by hand (kerns) until the gaps look even — rounds closer, straight stems further apart; never leave an obvious hole (T·o, A·V, r·n).
- **Then weight.** Use variable axes for the exact weight (wght 560 instead of 500/600), width (wdth) to fit the mark, and optical size (opsz = the display size) so details stay crisp. Match the mark's stroke weight optically.
- **Then details.** One or two moves, not five: a stylistic set or a single alternate (set_type alternates) for a distinctive letter, a ligature that tells the story, small caps for a tagline, oldstyle figures for heritage. Each must earn its place.
- **Pair with contrast.** suggest_pairings(heading) gives body fonts that contrast in structure (serif × sans) but share x-height and mood; save with set_type_system so the user can apply them in one click.
- **Check small sizes.** check_small_sizes after any spacing change: tight tracking and hairline alternates fill in at 16–32 px — open up tracking a little for the small-size version if needed.
- Lettering keeps these settings: set type on the text first, then make_lettering; set_type on the group swaps letters for alternates and nudges single letters (kern, baseline, scale).`,

  lettering: `# Custom lettering (wordmarks with character)

- make_lettering(id) turns a text layer into one editable path per letter (group named after the word, letters named S, H, O…), at the exact same positions and kerning. Do it only when letters need custom shapes or layouts — plain text stays easier to retype.
- Customize single letters: a ligature-like swash on one letter (apply_ops update d), a curled terminal (deform_path bend on that letter), a symbol replacing a counter (replace a letter with set_svg replace_ids), a color accent on one letter.
- arrange_letters(group_id, layout, amount): arc for badges/emblems (top line positive sweep ~90–160°, bottom line negative), wave for playful marks (20–40%), rise for energetic marks (40–80%), stagger for bouncy/kid brands (15–30%). straight resets. Layouts replace each other.
- Keep spacing even after editing letters: optical spacing (round letters closer, straight stems further apart) beats equal gaps.
- Text on a badge: match the arc to the ring — the sweep grows with the word's length relative to the ring circumference; keep letters upright-reading on the bottom line (negative sweep).`,

  warp: `# Warp & effects (warp, warp_envelope, add_effect)

- **Subtle reads best on logos.** Amounts of 15–40 give character without hurting legibility; 60+ is for playful/display marks only. Arc (badges, crests) and arch (sporty, retro) are the safe classics; rise, flag and perspective are energetic; bulge/pinch/fisheye/squeeze are strong — use sparingly.
- **One piece.** Pass every layer that should bend together (wordmark + underline, letters + mark) in one warp call: they share one envelope. Text becomes lettering (one path per letter) in the same step.
- **Re-editable.** The warp is stored on the layers: calling warp/warp_envelope again replaces it from the original geometry, amount 0 restores it. If letters were reshaped by hand since, the next warp starts from the current shapes.
- **Free envelope.** warp_envelope with bow {top: 15} arches only the top edge; corners make tapers and perspective-like slants (e.g. pull tr/br inward for a wedge). Keep corner moves small relative to the letter height.
- **Effects are layers.** add_effect builds outline (gap + width around the letters), inline (fine line inside thick strokes), shadow (drop or solid long shadow, angle 45° default) and double (two outlines) as real paths inside an effects group. Warping that group rebuilds its effects.
- **Proportions.** Outline gap ≈ 3–5% and width ≈ 3–6% of the letter height; inline width ≤ ⅓ of the thinnest stroke (inline needs heavy weights); long shadows 8–20% of the letter height. Use the ink colour for outlines, the background colour for inlines, a darker shade for shadows.
- **Always check small sizes after warping or adding effects** (check_small_sizes): thin outlines and inlines vanish at 16–32 px — drop or thicken them for icon versions.`,

  palette: `# Brand palette (generate_palette, set_palette, make_colorways)

- **Contrast first.** The lead color must read on the ground at ≥ 3:1 (logos, icons, large text) and body text needs ≥ 4.5:1. Check the pairs generate_palette lists before you commit.
- **Logos need few colors.** 1 primary + 1–2 support colors, plus a dark ink and a light ground. More colors belong to the wider brand, not the mark.
- **Lightness carries the design.** Keep a clear light/dark step between the mark and its ground; hue alone doesn't separate shapes at small sizes or for color-blind viewers.
- **Test one-color versions.** make_colorways shows the mark in every palette combination: the one-ink columns are the real test (stamps, embroidery, single-color print). If details vanish there, open them up or rely on negative space.
- **Read the user's palette.** get_document lists the brand palette when there is one — use those exact colors. Locked colors are decisions: never change them; generate_palette keeps them while the rest changes.
- **Workflow.** generate_palette (harmony, count, save=true) → render_preview with the colors applied (set_palette apply_to=<version>) → make_colorways → keep only what the user asks for as versions.`,

  animation: `# Logo animation (set_animation, preview_animation)

- **Subtle and short.** An entrance should finish in under 1.5 s (most feel right at 0.8–1.2 s). It ends on the exact static logo, so nothing is lost when it stops.
- **One gesture.** Pick one entrance that fits the brand: fade-up or scale-in (calm, corporate), draw (line marks, crafted/heritage — the outline draws, then the fill flows in), wipe (wordmarks, left→right), pop or bounce (playful), assemble (marks built from separate pieces), cascade (letters one by one). Don't mix many kinds; use overrides only to make one part special (e.g. the symbol draws, the wordmark fades).
- **Stagger by meaning, not by layer.** Symbol first, then the name, then the tagline; letters left→right; radial marks center-out. Pass part_ids for an explicit order (letters from make_lettering are separate parts). Stagger 40–90 ms between letters, 120–250 ms between big parts.
- **Easing.** expo/quint (confident ease-out) for most entrances; back only for playful brands; never linear for movement.
- **Loops are barely noticeable.** float or breathe at intensity ≤ 0.5, a slow shimmer for metallic/premium marks, rotate only for round marks that read when spinning (12 s+ per turn). Leave the loop off unless the logo lives on screen (site hero, app splash, stream overlay).
- **Look at it.** preview_animation shows numbered frames across the timeline; check the first frame isn't cluttered, parts don't collide mid-motion, and the end frame is the settled logo. Exports: anim-svg (web), gif (chats, email), anim-video (MP4; transparent → WebM).`,

  lockups: `# Lockups (make_lockup, get_lockup_metrics)

- **Balance by numbers, not by eye.** get_lockup_metrics gives the mark height in cap heights (ratio), the ink gap in cap heights and mark strokes, alignment offsets, optical centring, clear space and a minimum size. Change one number at a time with make_lockup; it keeps what you don't pass.
- **Usual ranges.** Horizontal: mark 1.4–2.2 × cap height (heavy/solid marks lower, airy line marks higher), gap 0.5–1 × cap. Stacked: mark 2.5–4 × cap, gap 0.6–1.2 × cap, mark optically centred over the word.
- **Alignment.** optical (default) puts the mark's visual centre on the cap band (x-height band for all-lowercase words) — right for most marks. cap = geometric centre on the cap height (boxy marks). baseline = the mark sits on the baseline (tall marks, monograms that act like a letter).
- **Optical centring.** The lockup is centred on its contrast-weighted visual centre, so heavy marks don't make it look off-centre; use center "bbox" only when the user wants strict geometry.
- **A set, not one file.** make_lockup arrangement ["horizontal","stacked","wordmark-only","icon-only"] with as_versions builds the whole family side by side, each artboard fitted to its clear space. Name the symbol group id="icon" so parts are found reliably (or pass mark_ids / wordmark_ids).
- **Clear space and minimum size.** Default clear space = 1 × cap height (or ¼ of the mark for icon-only). Report the minimum size to the user (screen px and print mm) when presenting a lockup.
- Exact type metrics need the studio open (real glyphs); without it cap height is estimated from the font size — say so if the numbers matter.`,

  shapes: `# Shapes library (search_shapes, insert_shape)

- **Raw material, not the answer.** Library shapes are starting geometry: insert one, then make it yours — change proportions, cut it with negative space, combine two shapes into one idea, deform it, round or sharpen corners to match the rest of the mark. Never present an unmodified stock icon (icon:…) as the user's logo; it isn't distinctive and anyone can use it.
- **Parametric first.** Our generated shapes take parameters (points, inner radius, roundness, thickness, seed…): search_shapes lists them. Tune them in insert_shape params instead of redrawing — e.g. star points=6 inner=0.6 round=0.4, blob seed=12, laurel leaves=7.
- **Good uses.** Containers (shields, seals, badges, frames), construction pieces (arcs, bowls, stems, quarter circles for geometric monograms), accents (sparkles, rays, laurels, speed lines), and quick symbols to riff on (leaf, drop, flame, bolt, globe).
- **Consistency.** Match the inserted shape's stroke weight, corner radius and optical size to the rest of the logo; check with render_preview and check_small_sizes (patterns and thin rings fill in at 16–32 px).
- Icons are Phosphor Icons (MIT): "Solid" (weight 0) and "Line" (weight 1) styles, both filled outlines. Brand logos are not in the set.`,
};
