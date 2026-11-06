# Getting started

Brusshy is a logo studio that runs on your computer. You open a drafting-table canvas in your browser, and **your own AI** (Claude Code, Codex, Gemini, Grok, Cursor or any MCP client) designs on it while you watch, guide and edit by hand. No account, no server, no AI bill from us.

## 1. Requirements

- Node.js 20 or newer
- A modern browser (Chrome, Edge, Safari 17+, Firefox)
- An AI client that supports MCP (Claude Code recommended — the canvas chat can also run it for you)

## 2. Install the design skill

```bash
npx skills add mavsy11/brusshy -g
```

The skill teaches your AI how to design a logo: find the idea, draw it on a construction grid, check it at small sizes.

## 3. Open the studio

```bash
cd your-project
npx brusshy
```

The studio opens at `http://localhost:4848` (next free port if busy). Everything you make is saved in `./brusshy/`:

| Folder | What |
|---|---|
| `brusshy/*.brusshy.json` | Your logo documents (with full undo history) |
| `brusshy/refs/` | Images you traced or vectorized |
| `brusshy/brand/` | Drop guidelines, palettes, old logos — your AI reads them |
| `brusshy/exports/` | Everything you export |

## 4. Connect your AI (once per project)

```bash
npx brusshy init
```

This writes `.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor), plus the config of any AI below that you have installed. Restart your AI session and approve the `brusshy` server. To use it in every project with Claude Code:

```bash
claude mcp add brusshy -s user -- npx -y brusshy mcp
```

Your AI may need a different setup:

| AI | How to connect |
|---|---|
| Claude Code, Cursor | `npx brusshy init` |
| Gemini | `npx brusshy init --client gemini` (Gemini CLI) or `--client antigravity` |
| Codex | `npx brusshy init --client codex`, then trust the folder when Codex asks |
| ChatGPT | The desktop app (Settings → MCP servers) or Codex, signed in with ChatGPT. ChatGPT on the web can't reach a server on your computer. |
| Grok | `npx brusshy init --client grok` (Grok Build) |
| Any other MCP client | Add a server that runs `npx -y brusshy mcp` in your project folder |

You choose where to chat. The chat box on the canvas runs Claude Code for you, and it can run Codex if you connect it from the chat's menu. With any AI, you can also keep chatting in its own terminal: the canvas updates either way.

## 5. Design

Ask your AI, in its chat or in the studio's chat box at the bottom of the canvas:

> Design a logo for **Northwind**, a specialty coffee roaster. Modern and warm, not rustic. Must work as an app icon and a 16 px favicon.

Then:

- **Pin notes** on any part (note tool, or `C`): *"make this curve rounder"*. Your AI applies them and replies.
- **Edit by hand**: move, scale, rotate, edit nodes, bend and twist, warp text. Your AI sees what you changed and keeps it.
- **Lock** parts you love so the AI never touches them.
- **Compare directions**: ask for 4 variants, then click *Continue with this* on the one you like.
- **Write a Brief** (top bar) — your AI reads it before every design.
- Press **⌘K** for every command.

## 6. Ship it

**Export** gives you SVG (outlined text), PNG at any size, one-color versions, favicon and app-icon kits, 3D renders, animated SVG/MP4/GIF, mockups, a brand-kit PDF, and a `brand.md` with the brand rules (including what not to do) for your AI to read.

## Next

- [Prompts that work](../skills/logo-designer-studio-brusshy/references/prompts.md)
- [Vectorize a sketch, photo or object](guides/vectorize.md)
- [The design skill for your AI](../skills/logo-designer-studio-brusshy/SKILL.md)
