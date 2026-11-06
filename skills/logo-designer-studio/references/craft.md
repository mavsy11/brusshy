# Craft: drawing marks that hold up

## Construction

- Work in the artboard's units (default 1024×1024, origin top-left). Leave 12–18% margin; the visual centre sits slightly above the geometric centre.
- Build from a small set of primitives and one angle system (0/45/90°, or 30/60°). Snap key points to a grid (8 or 16 units); use the same radius family everywhere.
- Prefer cubic curves with as few nodes as possible; put nodes at extremes (top/bottom/left/right of curves) with horizontal/vertical handles.
- Holes: reversed subpaths (opposite winding) or `fill-rule="evenodd"`. Keep shapes closed and non-self-intersecting so they extrude cleanly in 3D.
- Name every meaningful part (`id="lens"`, `id="bowl"`), group the symbol as `<g id="icon">`.

## Construction grids

- A grid is a tool for *finding* consistent curves and proportions, not a decoration added afterwards. Build with it; show it only if it explains real decisions.
- **Circle grid**: place a few circles whose radii follow one ratio (1:2, 2:3, or the golden ratio 1:1.618) on a square grid; every curve of the mark is an arc of one of those circles, every straight line follows the square grid or 45°. Shapes come from the *regions between intersecting circles* (lens and petal shapes).
- **Keylines**: a square, a circle and a centred diamond of the same visual size — helps icons of different shapes feel equal.
- **Radial grid**: for flowers, suns and apertures: N equal sectors; draw one unit, rotate copies by exactly 360/N.
- Present construction (circles, guides, hatched regions) only in the brand presentation; the logo itself ships clean.

## Optical corrections

- Round and pointed shapes overshoot the baseline/cap line by ~2–3% to look the same size as flat ones.
- Horizontal strokes slightly thinner than vertical ones (≈90%) look equal.
- A triangle (play button) looks centred when its *visual* centre — between its box centre and its centroid — is centred, not its bounding box.
- Inner corners where two strokes meet get a small notch or are kept sharp so they don't fill in at small sizes; outer corners carry the rounding.
- Wide marks look smaller than tall ones at the same height; balance by area, not by box.

## Weight, corners, consistency

- One or two core elements and one focal point. A third element has to carry the idea, or it goes.
- One stroke weight (or a 2-step system) and one corner radius family across the mark and its icon set.
- Counters and gaps ≥ the stroke weight, or they close at 16 px.
- Avoid hairlines thinner than ~2% of the artboard. Thin details vanish first; thicken or remove them.
- A mark made only of a few thin lines looks fragile, even when each line clears the hairline limit. Give it mass: a solid shape, thicker strokes or dense repetition.
- High stroke contrast (thin strokes under about a third of the thick ones) is a large-size design: at 16 px the thin strokes drop out and the mark turns into its heavy parts. Keep it for large sizes and make a small-size cut that thickens only the thin strokes, the way type foundries make optical sizes. Critique flags it.
- Nested shapes share a corner centre: the inner radius is the outer radius minus the gap between them (a badge with radius 96 and a 32-unit inset holds a shape with radius 64). Equal radii on nested shapes look pinched at the corners.

## Color

- Start in one color. Then 1 primary + 1–2 support colors + a dark and a light ground.
- Check WCAG contrast of the mark's main color on its grounds (≥3:1 for graphics). Plan a reversed version for dark grounds instead of compromising the main one.
- Gradients only when the style calls for it; the flat version must still work.

## Wordmarks

- Pick the face for the brand's voice, then fix **spacing first** (optical kerning, tighter tracking for heavy weights, looser for caps), then weight, then details.
- Customize one or two letters at most (a cut, a ligature, a swash) — enough to own it, not enough to hurt legibility.
- Lockup: mark height ≈ 1.6–2.2× cap height for horizontal, gap ≈ 0.5–1× cap height; align by optical centre, not box.
- Clear space is measured in a unit taken from the logo itself (the symbol's height, or the wordmark's cap height), so it scales with the logo; give the minimum size in px next to it.

## Tells of a generated logo

Never ship these unless the brief asks for them by name; each one makes a mark read as made by a prompt:

- A purple-to-blue or cyan gradient, a glow or an outer shadow.
- Sparkles or stars standing for "AI" or "magic" without a reason in the concept.
- A letter in a rounded square, or a symbol next to a default geometric sans set as it comes, with no spacing work.
- A gradient or texture covering a weak silhouette: if the flat one-colour version doesn't hold, the mark doesn't.
- Perfect symmetry and even spacing everywhere, with no optical correction anywhere.

## Small sizes and real use

- 16 px favicon and app icon often need their own simplified drawing: fewer details, bigger counters, pixel-aligned features.
- Test on light and dark, in a browser tab and on a phone home screen (`render_mockup`).
