# Contributing to Brusshy

Thanks for helping! Brusshy is a monorepo (npm workspaces):

| Package | What |
|---|---|
| `packages/core` | Document model (zod), invertible ops, history, geometry, SVG I/O, design math (deform, warp, palette, lockups, critique…) |
| `packages/shapes` | The SVG shapes library |
| `packages/brusshy` | The published CLI: local daemon, MCP server and tools (`src/tools/*.ts`) |
| `packages/studio` | The canvas app (React + Vite + zustand, three.js) |
| `skills/` | The design skill for AI agents |
| `docs/` | User guides |

## Develop

```bash
npm install
npm test
npm run typecheck
BRUSSHY_DIR=.dev-project npx tsx packages/brusshy/src/cli.ts start --dev --no-open   # daemon
npm run dev                                                                           # studio on :5173
BRUSSHY_DEV=1 node packages/brusshy/test/draw.mjs .dev-project get_document '{}'      # call MCP tools from source
```

## Principles

- **Every change is an op.** Edits from the user and the AI go through `applyOps` so undo, history and "what the user changed" keep working.
- **Pure logic lives in `core`** with tests; the studio and the MCP call it.
- **New MCP tools** go in `packages/brusshy/src/tools/<feature>.ts` and register with one line in `tools/index.ts`. Respect AI locks.
- **Design quality is the product.** Look at your change (screenshots, `render_preview`) before opening a PR. Follow the tokens in `packages/studio/src/styles/tokens.css`.
- Keep dependencies license-compatible with MIT and list new ones in `THIRD_PARTY_NOTICES.md`.

## Pull requests

Small and focused, with a short description, screenshots for UI changes, and `npm test` + `npm run typecheck` passing.
