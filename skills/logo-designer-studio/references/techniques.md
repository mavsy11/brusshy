# Techniques: ways to build a mark

Classic trademark catalogs organize marks two ways: **letter-based** (one letter, many treatments) and **symbol-based** (one subject — hand, bird, sun — many constructions). Use the lists below to generate many candidates fast: pick a letter or subject, run it through 6–10 techniques, keep the 2–3 that carry the idea. Copy the *technique*, never a specific mark.

## Letter-based (monograms, initials, wordmark details)

| Technique | What it does | Watch out |
|---|---|---|
| Stencil / split | Cut the letter with one or two bars or a diagonal gap | Gaps ≥ stroke weight or they close at small sizes |
| Modular | Build the letter from repeated units (squares, dots, quarter circles) on a grid | Keep units few and identical |
| Single stroke / monoline | One continuous line, constant weight | Joins and terminals decide the quality |
| Inline / outline | A line runs inside the strokes, or only the contour remains | Inline needs bold weights |
| Negative space | The letter is the space between shapes, or a symbol hides in the counter | The hidden form must be findable |
| Interlock / ligature | Two letters share strokes or overlap with a weave (over-under) | Weave crossings must alternate consistently |
| Fold / ribbon | The letter looks folded from a strip; light and shadow sides | Use 2 tones max |
| Rotation / mirror | The letter reads two ways when rotated or reflected (ambigram, rotational symmetry) | Test both readings at small size |
| Container | The letter sits inside or cuts out of a shape (circle, square, shield) | Container shape must add meaning, not just a frame |
| Perspective / extrusion | Implied 3D: isometric faces, tilted planes | Keep it flat-printable |
| Fragmented | Letter assembled from slices, steps or rays | Rhythm of the slices must be even |
| Object-letter | The letter is also an object (P = flag/play, A = mountain) | One clear double reading |
| Dot swap | The dot of an i or j (or a period) becomes a small brand element: spark, leaf, drop, star | One element, sized to match the round dot optically; at 16 px it must still read as a dot |

## Symbol-based (pictorial and abstract marks)

| Construction | Typical subjects | Notes |
|---|---|---|
| Radial repeat | Flowers, suns, stars, apertures, wheels | 3–12 identical petals rotated around a centre; vary the petal, not the count |
| Mirror symmetry | Faces, birds, insects, crests | Draw half, mirror; break symmetry once for life |
| Circle construction | Animals, leaves, organic forms | Every curve is an arc of a circle from the grid (see grids) |
| Modular grid | Pixel animals, buildings, abstract patterns | Fixed cell size; rounded or square cells |
| Line-based | Landscapes, waves, motion, sound | Parallel lines, equal weight and gaps |
| Positive/negative swap | Two subjects sharing an edge (face/vase, bird/leaf) | The shared edge carries the idea |
| Silhouette + cutout | Animals, objects | Solid silhouette with one meaningful cut |
| Geometric reduction | Any subject | Reduce to triangles/circles/squares until only the gesture remains |

## Using it in Brusshy

- Exploring: `make_variants` with one technique per variant, and say which technique each one uses.
- Radial and mirror constructions: draw one unit cleanly, then repeat it with exact rotation/mirroring (one transform per copy) — never eyeball the copies.
- Then refine the chosen one with [craft.md](craft.md) and check it with [critique.md](critique.md).
