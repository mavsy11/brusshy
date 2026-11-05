# Process: from brief to one strong idea

## Discovery (ask yourself, or the user when it matters)

Fill the gaps the Brief leaves. Ask the user only the 1–2 questions whose answer would change the design; infer the rest and say what you assumed.

- **What is it?** Product, audience, the one thing it does better than others.
- **Where does it live?** App icon, favicon, storefront sign, embroidery, packaging, social avatar, video intro. This sets the constraints (square tile? one color? tiny?).
- **What must it feel like?** Three adjectives, and one it must *not* feel like.
- **What exists already?** Name, existing colors or mark, competitors to stay away from.
- **Mark type**: symbol + wordmark, wordmark only, monogram, emblem/badge, mascot.

## Generating concepts

**Start by naming the cliché.** Before any concept, write the one idea every designer in this category would draw first (an animal head in a round badge, a letter in a box or an arch, a compass or a pin for navigation, a bolt for energy, concentric rings for water, a document or a chart for finance, a leaf for eco). That is the bar to beat, not a candidate. A concept may use the cliché's subject only if it adds something no other company could own: a second reading, a cut, a construction, a gesture from this brand's story.

Write 5–10 one-line concepts before drawing anything, then pick the strongest 1 (or 3–4 for `make_variants`). For each, say in one line what it has that the cliché doesn't; drop the ones with no answer. Techniques:

- **Word map.** List nouns, verbs and qualities around the brand; look for two that can share one shape (camera + play, leaf + flame).
- **Letter as form.** The initial or the whole name built from the concept (a P whose bowl is a play button).
- **Negative space.** A second reading hidden in the counter-forms; strongest when it is discovered, not explained.
- **Abstraction ladder.** Photo → illustration → icon → symbol → geometric sign. Logos live near the top; climb until only the essential gesture remains.
- **Constraint play.** Draw it only with circles, only with a 4×4 grid, only with one continuous line, only with 45° angles.
- **Metaphor of the verb.** Not what the company *is* but what it *does* for people (record → capture, edit → cut, share → send).

Reject concepts that are clichés of the category unless the execution is genuinely fresh (lightbulb for ideas, globe for "global", generic swoosh).

## Directions vs. variants

- **Directions** answer *what idea*: genuinely different concepts. Use `make_variants` with blank artboards and draw each one.
- **Variants** answer *how to execute one idea*: weight, corners, proportions, color. Duplicate the chosen version and change one variable at a time.
- When the user picks, `continue_variant` (or they click "Continue with this") and keep refining that one.

## Choosing

Pick with the generic test, not with polish: which direction would a stranger remember after one look, and which could only belong to this brand? A clean execution of the obvious idea loses to a rougher one that says something. Say why you picked it.

## Refinement order

1. Silhouette and proportions (mono, at 64 px and at 16 px).
2. Construction: grid, circles, angles; then optical corrections.
3. Detail and negative space.
4. Color (1 primary, 1–2 support, a dark and a light ground).
5. Wordmark: font choice, then spacing, then custom details (lettering, ligatures).
6. Lockups, small-size variant (favicon), reversed version, motion.

Push the chosen direction at least twice before calling it done. Each pass changes something you can see in the silhouette — a proportion, a cut, a negative-space detail, a sharper construction — never only colour or position. Duplicate the version before each pass (`duplicate_frame`), compare before and after with `render_preview`, and keep the stronger one — the latest is not automatically the best. A clever idea that a stranger can't read at a glance loses to a simpler one that they can: describe the 64 px render in three plain words; if they don't name the idea, simplify or go back.
