# Security

Brusshy runs a small local server while you design. Its model:

- It binds to `127.0.0.1` only and rejects requests whose `Host` or `Origin` isn't local (DNS-rebinding protection). Other websites can't call its API: every call needs a custom token header, and no CORS headers are sent.
- Every API call and the WebSocket need a per-run token stored in `brusshy/.daemon.json` (file mode 600). The studio is opened at `http://localhost:<port>/#t=<token>`: the token travels in the address fragment, which browsers never send to a server, a log or a `Referer`, and the studio removes it from the address bar right away. The page itself carries no token.
- Images in `refs/` and `brand/` are served with a sandbox policy (no script), so a planted SVG can't run code on the studio's origin. Other sites can't load them (`Cross-Origin-Resource-Policy`), and nothing behind a symlink is served, read or written, including a symlinked `brand/` folder.
- `brusshy/.gitignore` keeps the session file and chat history out of git if you commit your logos.

## The canvas chat

When you type in the chat, Brusshy runs **your own** AI CLI on your own plan. Nothing goes through a Brusshy server (there is none).

- **Claude Code** runs with Brusshy's MCP tools only: no shell, no file or web tools, no other MCP servers. It starts from a folder Brusshy owns (`~/.brusshy/chat/<project id>/`), so a project's `CLAUDE.md`, `.claude/` settings or hooks never load. Project and local settings, hooks, and slash commands and skills are off. The request goes in on stdin (not visible in the process list). A run stops after 20 minutes, and Stop ends the CLI and the processes it started.
- **Codex** is off in the chat until you connect it from the chat's menu, which asks first; your answer is kept in `~/.brusshy/`, outside any project. It starts from the same Brusshy-owned folder with your Codex config, rules and project docs ignored and its shell and web tools off. Its patch tool has no off switch, so only its read-only sandbox stops it writing files, which is why it asks. You can always keep using Codex in its own terminal instead.
- **Connected AI** (no CLI in the chat): the request waits until the AI client you connected picks it up. That client works with *all* the tools you gave it, so treat the chat like typing into that client.

**Pasted images** are downsized and re-encoded in the browser before upload (this also drops metadata such as GPS location). The daemon accepts only PNG, JPEG, WebP or GIF up to 3.75 MB and 8192 px, checks the bytes rather than the name, and stores them under random names in `brusshy/.chat/images/`. The AI sees them only through the `get_chat_images` tool. The AI is told that images are references and that text inside an image is not an instruction, but that is a soft defense: don't paste images you wouldn't show your AI client directly.

## Reporting

Found a vulnerability? Please open a private security advisory on GitHub (Security → Report a vulnerability) instead of a public issue.
