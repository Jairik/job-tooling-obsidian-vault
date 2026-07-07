# Prerequisites

This file lists the system-level prerequisites found by scanning the repository
manifests, launch scripts, documentation, and process-spawning code.

## Required

- **Bun 1.3+**: the server, web app, TUI, dependency install, and tests all run
  through Bun. The main commands are `bun install`, `bun run dev`,
  `bun run tui`, and `bun test`.
- **A POSIX shell with Bash**: `./run.sh` is the one-command launcher and starts
  with `#!/usr/bin/env bash`.
- **Claude Code authentication or an Anthropic API key**: the default engine is
  Claude Code through `@anthropic-ai/claude-agent-sdk`. Sign in with the
  `claude` CLI, or set `ANTHROPIC_API_KEY` in `.env`.
- **A local vault or context directory**: the app defaults to `VAULT_DIR` from
  the environment. The path can also be set during onboarding or in Settings.
- **Network access for installation and model calls**: first install needs to
  fetch Bun packages, and answer generation needs access to the configured model
  provider.

## Optional Engine CLIs

These are required only when selecting the matching non-Claude engine. Each must
be installed, authenticated with its provider, and available on `PATH`.

| Engine setting | Executable checked by the app |
| --- | --- |
| Gemini Antigravity | `agy` |
| OpenCode | `opencode` |
| Cursor Agent | `cursor-agent` or `cursor` |
| GitHub Copilot | `copilot` |
| Codex | `codex` |

OpenCode usage stats additionally call `opencode stats --days 7 --models 10`.
Codex usage reads the local Codex auth state, or `CODEX_ACCESS_TOKEN` when set.

## Optional Feature Dependencies

- **LaTeX/PDF document output**: install `tectonic` on `PATH`. The app uses
  `tectonic --untrusted` to compile generated `.tex` documents. The first compile
  may download TeX packages.
- **Local web research search**: run a local SearXNG instance on a loopback URL
  such as `http://127.0.0.1:8080`, with JSON search enabled. The documented
  example uses Docker, so Docker or another container runtime is needed only if
  you choose that setup path.
- **Local web research browser fallback**: install Playwright's Chromium browser
  with `bunx playwright install chromium` if you want the `Auto` fallback or
  `Chromium` URL fetch mode. Readability-only page extraction does not require a
  browser binary.
- **TUI external editor**: the TUI's Ctrl+O editor path uses `$VISUAL`, then
  `$EDITOR`, then `vi`. Install or configure an editor if `vi` is unavailable.
- **TUI clipboard integration**: native clipboard copy uses platform tools such
  as `wl-copy`, `xclip`, `xsel`, or `pbcopy` through `clipboardy`. If none are
  available, the TUI falls back to OSC-52 terminal copy when supported.
- **User skills**: optional custom skills are discovered from
  `~/.claude/skills` and `<vault>/.claude/skills`.

## Not Required

- A separate Node.js runtime is not required for normal use; Bun runs the
  TypeScript server and scripts directly.
- No database service is required. Settings, sessions, attachments, and logs are
  stored in local files.
- PDF and DOCX attachment text extraction is handled by TypeScript libraries, so
  Poppler, LibreOffice, or OCR tools are not required. Scanned/image-only PDFs
  are not supported.
- RAG retrieval is implemented locally in TypeScript and does not require an
  embeddings service or API key.

## Desktop app (Tauri)

The `src-tauri/` project wraps the app as a standalone desktop executable. The
Tauri shell spawns the normal Bun server as a **sidecar** and points its window at
`http://localhost:PORT`, so the packaged app runs the exact same runtime as
`./run.sh` — the UI, `/api`, SSE streaming, and the agent are unchanged.

Building the desktop app additionally requires:

- **Rust toolchain** (`cargo`, `rustc`) — install via [rustup](https://rustup.rs).
- **Tauri Linux system libraries**: `webkit2gtk-4.1`, `gtk3`, `libsoup-3.0`,
  `javascriptcoregtk-4.1` (Arch: `sudo pacman -S webkit2gtk-4.1 gtk3 libsoup3`).
  macOS needs Xcode command-line tools; Windows needs the WebView2 runtime + MSVC.
- **Bun on `PATH` at build time**: `src-tauri/scripts/prepare-sidecar.sh` copies the
  host `bun` binary into `src-tauri/binaries/bun-<target-triple>` to ship as the
  sidecar. To cross-build, drop that platform's `bun` binary there first.
- **The Tauri CLI**, provided as a dev dependency (`bun install`) or via
  `bunx @tauri-apps/cli`.

Run it:

```bash
bun install          # installs @tauri-apps/cli
bun run desktop      # tauri dev — live window, spawns the Bun sidecar
bun run desktop:build  # tauri build — produces .AppImage / .deb under src-tauri/target
```

Runtime notes for the packaged app:

- Writable state (`config.json`, `logs/`, `.attachments/`, `.sessions.json`) is
  redirected to the per-user app-data dir via the `VA_DATA_DIR` env var (see
  `agent/paths.ts`) instead of the repo root. The global npm/bun CLI install
  (`vault-assistant` on `PATH`) gets the same guarantee without needing
  `VA_DATA_DIR` set explicitly: `agent/paths.ts` probes whether its default
  (the install directory) is writable and falls back to the same kind of
  per-user XDG-style data directory automatically if not. `VA_DATA_DIR` is
  still available as an explicit override for all three distribution paths
  (Tauri, Docker, npm/bun CLI).
- The optional features above (`tectonic`, Playwright Chromium, alternate engine
  CLIs, SearXNG) remain host dependencies. The shell augments the sidecar's `PATH`
  with the usual user bin dirs so installed tools are found.
- The app is **not** a single compiled binary: `bun build --compile` is not viable
  here because css-tree needs real package files for `createRequire` JSON data,
  Playwright resolves subprocess assets at runtime, and the Claude Agent SDK
  spawns its own native subprocess. Release packaging instead stages a
  `bun build --target=bun` server bundle plus only the external runtime packages
  that still need files on disk, including the single matching Claude SDK native
  package for the build platform.

## Quick Check

```bash
bun --version
bun install
bun test
./run.sh
```
