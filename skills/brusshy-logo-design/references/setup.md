# Connecting Brusshy to your AI

Brusshy runs on your machine (Node 20+). It has no account, server or AI of its own: your AI client does the thinking with your plan.

## Claude Code

```bash
cd your-project
npx brusshy init          # writes .mcp.json for this project
claude                    # restart your session; approve the brusshy MCP server
```

Or register it for every project:

```bash
claude mcp add brusshy -s user -- npx -y brusshy mcp
```

## Other AI clients

`npx brusshy init` also writes `.cursor/mcp.json`, plus the config of Gemini CLI, Antigravity, Codex or Grok Build when they are installed. To pick them yourself: `npx brusshy init --client gemini,antigravity,codex,grok`.

ChatGPT connects through its desktop app or Codex, signed in with ChatGPT; on the web it can't reach a local server. For any other client, add an MCP server that runs `npx -y brusshy mcp` in your project folder.

## Use it

Ask your AI: *"Open Brusshy and design a logo for Northwind, a coffee roaster — modern, warm, works at favicon size."* The studio opens at `http://localhost:4848`. You can also type requests in the studio's chat box, or keep chatting in your AI's own terminal: the user chooses. The chat box runs Claude Code, or Codex once they connect it from its menu.

## Install this skill

```bash
npx skills add mavsy11/brusshy --skill brusshy-logo-design -g
```
