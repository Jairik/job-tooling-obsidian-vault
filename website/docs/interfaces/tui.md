---
id: tui
title: Terminal interface (TUI)
---

# Terminal interface (TUI)

The TUI is a full terminal client built with React and Ink. It talks to the same server and API as the web interface, so answers, settings, and sessions are shared. If a server is already running it connects to it; otherwise it starts one itself and shuts it down when you quit.

## Launching

Any of these work, depending on how you installed:

```bash
vault-assistant --tui    # global npm install
./run.sh --tui           # from a source checkout
bun run tui              # from a source checkout, direct
```

Command-line flags:

| Flag | Effect |
| ---- | ------ |
| `--port <n>` | Port to use when connecting to or starting the local server |
| `--server-url <url>` | Attach to an already-running server at a specific address |
| `--mode ask\|draft\|write` | Start in a specific mode |
| `--full-screen` | Use the full terminal instead of an inline layout |
| `-h` | Show help |

## What it covers

The TUI runs one session at a time, switchable between Ask, Draft, and Write modes, including the full write-approval flow with diffs. Settings, the skills picker, logs, the RAG toggle, engine and model selection, and answer cleanup all work from the terminal. Inline hints at the bottom of the screen show the active key bindings.

Editing longer text opens your external editor, using `$VISUAL` or `$EDITOR` and falling back to `vi`. Copying answers uses your system clipboard tools when present, with an OSC-52 escape fallback for terminals over SSH. Both are covered in [System prerequisites](../getting-started/prerequisites.md).

## Differences from the web interface

The TUI keeps the core workflow and drops the workspace chrome. Compared with the [web interface](web-app.md) it has:

- One session instead of tabs, and no split view.
- No quick notes drawer.
- No themes, density, or appearance settings; it uses your terminal's colors.
- No onboarding wizard or shortcut overlay. First-run configuration happens in the web interface or in the settings screen.
- Usage and logs as plain text rather than charts.
- A LaTeX toggle, but no inline PDF preview. Compiled output still lands on disk through the server.
- Document attachments in Draft mode only.

If you mostly ask questions and draft text, the TUI covers the day-to-day work. For the visual features, open the web interface; both can run against the same server at once.
