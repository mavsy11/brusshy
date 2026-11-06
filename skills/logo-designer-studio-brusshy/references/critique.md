# Critique: judge your own work honestly

Run `critique` (deterministic checks + a render) and `check_small_sizes`, then add your own judgement. Pin actionable findings as notes on the canvas so the user can apply them one by one.

## Two scores

`critique` returns a **craft** score: what can be measured (legibility, balance, contrast, complexity, consistency, alignment, spacing). 90+ means nothing is broken, not that the logo is good. Always add your own **concept** score, calibrated:

| Concept | Means |
|---|---|
| 90+ | A senior designer would sign it; people remember it after one look. |
| 75 | Solid and on-brief, but could belong to another company. |
| 60 | The first idea anyone would have: the category cliché, cleanly drawn. |
| < 50 | Clip art or a stock icon with a name next to it. |

Under 80 while you're designing: go back to the idea, don't polish.

**Stranger test.** Describe the 64 px render in three plain words, as someone who doesn't know the idea would ("a fox sleeping", not "warmth and craft"). If the words don't name the idea, it isn't reading: simplify, or keep the earlier version that did. An ambitious idea drawn so it can't be read scores lower than a plain one that reads.

## Checklist

| Area | Ask | Fix |
|---|---|---|
| Idea | Can you say what it means in one sentence? Is it ownable, not a category cliché? | Go back to concepts; simplify to the core gesture. |
| Silhouette | Does it read as one flat shape at 64 px? Does it have solid mass, or only a few thin lines? | Merge parts, remove details that don't change the silhouette; give thin marks mass. |
| Small sizes | Does it read at 16 px on light and dark? Is the stroke contrast too high for small sizes? | Thicken strokes, open counters, drop text from the icon, make a favicon variant (a small-size cut with the thin strokes thickened). |
| Balance | Is the visual centre on the artboard's optical centre? Does it lean? | Shift by visual mass; correct overshoots. |
| Consistency | One stroke weight? One corner family? One angle system? | Unify radii and weights; align near-misses. |
| Negative space | Are gaps and counters intentional and even? | Equalize gaps; make the hidden form clearer or remove it. |
| Color | 1–3 colors, contrast ≥3:1 on its grounds, works in one color? | Reduce palette; add a reversed version. |
| Wordmark | Even rhythm, no collisions, optical kerning, right weight next to the mark? | Adjust tracking/kerning, scale the mark to the cap height. |
| Craft | Clean nodes, no slivers, no self-intersections, named parts? | `refine` (simplify/smooth), redraw wobbly curves. |
| Brief | Every "must keep" kept, every "avoid" avoided? | Fix before anything else. |

## Tone

Be specific and short: *"The dot closes into the lens at 16 px — moved it 12 units right and enlarged it to 3 px."* Not: *"Improved legibility."*
