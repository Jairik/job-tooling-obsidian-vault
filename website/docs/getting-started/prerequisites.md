---
id: prerequisites
title: System prerequisites
---

# System prerequisites

This page lists the system dependencies required to install, build, and run the Vault Assistant.

## Core requirements

- **Bun 1.3 or newer:** Bun runs the web server, compiles frontend assets, executes the terminal interface, runs the test suite, and installs package dependencies.
- **POSIX Shell with Bash:** The main startup script `./run.sh` requires Bash.
- **Claude Code credentials or Anthropic API Key:** The default engine uses the Claude Code SDK. You must sign in using the `claude` CLI or save your `ANTHROPIC_API_KEY` in a `.env` file in the project root.
- **Local Vault Directory:** You must select a folder on your machine containing markdown or text files to use as your local knowledge base.

## Optional engine CLIs

If you select an engine other than Claude Code in your settings, most engines require the corresponding CLI on your system `PATH`. Codex can run through the bundled `@openai/codex-sdk` binary, or through a `codex` executable on `PATH` when `VAULT_CODEX_TRANSPORT=cli` is set. OpenCode runs through `@opencode-ai/sdk` against a persistent `opencode serve` process, but it still requires the `opencode` CLI on `PATH` (the SDK spawns it; there is no bundled binary like Codex's), or falls back to invoking `opencode` directly when `VAULT_OPENCODE_TRANSPORT=cli` is set.

| Engine setting     | Runtime checked by the app               |
| ------------------ | ---------------------------------------- |
| Gemini Antigravity | `agy` on `PATH`                          |
| OpenCode           | `opencode` on `PATH` (SDK or CLI)        |
| Cursor Agent       | `cursor` or `cursor-agent` on `PATH`     |
| GitHub Copilot     | `copilot` on `PATH`                      |
| Codex              | bundled SDK binary, or `codex` on `PATH` |

_Note: OpenCode usage statistics require `opencode stats`. Codex usage reads the local Codex authentication state or uses the `CODEX_ACCESS_TOKEN` environment variable._

## Optional feature dependencies

- **LaTeX and PDF compilation:** To output answers as formatted PDFs, you must install `tectonic` on your `PATH`. The server compiles generated files by calling `tectonic --untrusted`.
- **Local web research:** Running web searches locally requires a SearXNG instance running on your machine (usually on port 8080) with JSON output enabled.
- **Web browser extraction fallback:** If you want to extract text from pages that rely on JavaScript, install Playwright's Chromium browser by running:

  ```bash
  bunx playwright install chromium
  ```

- **TUI external editor:** Editing text from the terminal interface uses your system environment variables `$VISUAL` or `$EDITOR`. It falls back to `vi` if neither is set.
- **TUI clipboard tools:** Clipboard integration uses system commands like `wl-copy`, `xclip`, `xsel`, or `pbcopy`. If none exist, the interface falls back to OSC-52 escape codes.

## Features that do not require external tools

- **Database services:** The application writes settings, active sessions, temporary attachments, and logs directly to local JSON files in your workspace or user directory.
- **Text extraction:** The TypeScript code handles text extraction for PDF and DOCX uploads without requiring external software like LibreOffice or OCR packages.
- **RAG indexer:** The BM25 retrieval indexer is written in pure TypeScript and runs locally. It does not require any external vector database or API keys.

## Desktop application requirements (Tauri)

Building the optional desktop shell requires:

1. **Rust toolchain:** Install `rustc` and `cargo` using [rustup](https://rustup.rs).
2. **System libraries (Linux):** Install `webkit2gtk-4.1`, `gtk3`, and `libsoup-3.0` using your package manager.
3. **The Tauri CLI:** Run `bun install` to set up `@tauri-apps/cli`.

To start the desktop application in development mode:

```bash
bun run desktop
```

To compile the application package:

```bash
bun run desktop:build
```
