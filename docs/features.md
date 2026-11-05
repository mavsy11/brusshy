# Feature tour

Everything below works in the studio by hand **and** through your AI (MCP tools in parentheses).

## Start
- **Welcome screen** — style starters (minimal geometric, luxury serif, playful rounded, retro badge, tech monogram, hand-drawn, art deco, botanical line) that prefill a precise request; or sketch, trace, import an SVG, write a brief.
- **Canvas chat** — type a request at the bottom of the canvas; Brusshy runs your own Claude Code in the background with only Brusshy's tools (Codex too, if you connect it from the chat's menu; with any other AI, keep chatting in its own terminal or let your connected client pick the request up), and you watch each step land. No CLI? The request waits for the AI you have connected. Paste or drop up to 4 images into the chat to show your AI a reference (`get_chat_images`); they are downsized and stripped of metadata before they leave the browser.
- **Command palette (⌘K)** — every tool, action, version, layer, document and history step; "Ask your AI…" from the same box.
- **Brief** — subject, use, style, palette, type, must-keep, avoid, plus chips for mark type, style, shape and mood. Your AI reads it first.
- **Reference board** — up to 12 inspiration images with roles (reference, palette, silhouette, style) and notes (`get_board`). "Find references" opens public galleries for your brief chips.

## Explore
- **Variants** — several directions side by side; *Continue with this* keeps one (`make_variants`, `continue_variant`).
- **Technique explorer** — a letter or subject × techniques (stencil, modular, negative space, interlock, radial, mirror…) → one direction per technique (`list_techniques`).
- **Versions & history** — duplicate, compare, jump back to any step, with thumbnails.

## Draw
- **Vector editing** — shapes, pen-like node editing, bend and twist, soft selection, snapping, rulers (⇧R), outlines view (⌘Y), Code tab with live SVG.
- **Shapes library** — 241 parametric shapes (stars, bursts, blobs, badges, ribbons, frames, arrows, letter strokes, patterns…) and 1,432 open-license symbols; drag in, then customise (`search_shapes`, `insert_shape`).
- **Construction grids** — circle grids (1:2, 2:3, golden), keylines, radial grids; the **shape builder** fills the regions between circles; booleans (`add_construction`, `fill_region`, `boolean`).
- **Exact repeats** — radial ×N, mirror, grid arrays that update from their source (`repeat`).
- **Refine** — simplify, smooth, bolder/thinner, rounder corners, optical centre, snap to grid, make symmetric; "make it more…" chips for the AI (`refine`).
- **Vectorize** — sketches, flat artwork, and photos of real objects (silhouette, posterized, stencil, line art), fully local (`vectorize_reference`). See [the guide](guides/vectorize.md).
- **Notes & locks** — pin notes on parts; lock parts so the AI never touches them.

## Type
- **Type Lab** — variable axes (weight, width, slant…), OpenType features and alternates, optical kerning, per-letter kerning/baseline/scale (`set_type`).
- **Lettering** — each letter its own shape; arc, wave, rise layouts (`make_lettering`, `arrange_letters`).
- **Warp & effects** — arch, bulge, flag, fisheye… or a free envelope; outline, inline, shadow, double outline as real vectors (`warp`, `warp_envelope`, `add_effect`).
- **Fonts & pairing** — ~2,000 families, your name in every weight, heading + body type system (`suggest_pairings`, `set_type_system`).

## Check
- **Critique** — scored review (small sizes, balance, contrast, complexity, consistency, alignment, spacing) with findings you can pin as notes or send to your AI (`critique`).
- **Small sizes** — 16/24/32/64 px on light and dark (`check_small_sizes`).
- **Compare** — before/after slider, side by side, onion skin, difference highlight.
- **Mockups** — cards, app icon, browser tab, avatar, storefront, tote, letterhead, foil card and wall sign in 3D (`render_mockup`).

## Build the system
- **Lockups** — horizontal, stacked, icon, wordmark; ratio in cap heights, optical alignment, clear space, minimum size (`make_lockup`).
- **Palette & colorways** — OKLCH generator with locks and harmonies, colorways grid with contrast checks (`generate_palette`, `make_colorways`).
- **3D** — glass, chrome, gold, neon, porcelain… from the same vector.
- **Animation** — entrance and loop presets, timeline, animated SVG / MP4 / GIF (`set_animation`).

## Share
- **Export** — SVG (outlined text), PNG at any size, one-color, favicon & app-icon kits, 3D renders, GLB, video, animated SVG/GIF, mockups, brand-kit PDF, a `brand.md` of brand rules for AI agents (files per background, clear space, minimum size, colors, fonts, don'ts), **construction sheet**, **design timelapse**.
- **Presentation mode** — full-screen client deck: the mark, light/dark, small sizes, palette, type, versions, mockups and how it was made; PDF.
- **Timelapse** — replay how the logo was built, export 1:1 or 9:16 video/GIF for social.
