# Brusshy

**Design logos with your own AI.** A local drafting-table canvas that your AI (Claude Code, Codex, Gemini, Grok, Cursor, any MCP client) draws on while you watch — vector-perfect in 2D, premium in 3D.

```bash
npx brusshy          # opens the studio for this folder
npx brusshy init     # connects your AI (one time per project)
```

Then ask your AI: *“Design a logo for Northwind, a coffee roaster — modern, warm, works at favicon size.”*

## What you can do

- **Ask from the canvas** — type in the chat box at the bottom of the studio. Brusshy runs *your* Claude Code in the background (Codex too, if you connect it from the chat's menu; with any other AI, keep chatting in its own terminal) with only Brusshy's tools — no shell, no file access — and you watch each step land live. No CLI? The request waits for the AI you have connected.
- **Compare directions** — ask for 4 variants; they appear side by side and you click “Continue with this” on the one you like.
- **Sketch it** — draw the idea with the brush; your AI turns it into clean vector.
- **Trace it** — paste or drop a reference image; it stays as a tracing layer and is never exported.
- **Point at it** — pin notes on any part (“make this curve rounder”); your AI applies them and replies.
- **Fine-tune it** — handles, Bézier node editing, numeric panel, snapping, shortcuts. No tokens spent.
- **See it in 3D** — one click to frosted glass, chrome, gold, neon, porcelain… from the same vector.
- **Ship it** — SVG (outlined text), PNG at any size, monochrome, favicon/app-icon kit, 3D renders up to 4K, GLB, turntable video, brand-kit PDF, `brand.md` brand rules.

## Your files

Everything lives in `./brusshy/` in your project: the logos (`*.brusshy.json`), `refs/` (images you traced), `brand/` (drop guidelines, palettes, old logos — your AI reads them), `exports/`.

Nothing is uploaded anywhere. Brusshy has no account, no server and no AI of its own: your AI client does the thinking with your own plan.

## Commands and options

| Command | What it does |
| --- | --- |
| `npx brusshy` | Opens the studio for this folder, starting it if needed |
| `npx brusshy init` | Connects your AI to this folder (Claude Code and Cursor, plus Gemini, Antigravity, Codex or Grok if installed) |
| `npx brusshy init --client codex` | Connects only the clients you list, comma separated: `claude`, `cursor`, `gemini`, `antigravity`, `codex`, `grok` |
| `npx brusshy stop` | Stops the studio for this folder |

| Option | What it does |
| --- | --- |
| `--port <n>` | Port to try first (default 4848). Also set with `BRUSSHY_PORT` |
| `--no-open` | Don't open the browser |
| `BRUSSHY_DIR` | Environment variable: the project folder to work in (default: where you ran it) |

## Requirements

Node 20+. A modern browser (Chrome, Edge, Safari 17+, Firefox) for the studio.

More: [Getting started](https://github.com/mavsy11/brusshy/blob/main/docs/getting-started.md), [LICENSE](https://github.com/mavsy11/brusshy/blob/main/LICENSE), [SECURITY.md](https://github.com/mavsy11/brusshy/blob/main/SECURITY.md), [THIRD_PARTY_NOTICES.md](https://github.com/mavsy11/brusshy/blob/main/THIRD_PARTY_NOTICES.md).
