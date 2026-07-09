---
id: installation
title: Installation
---

# Installation

You can install Vault Assistant three ways: from npm, as a packaged desktop app, or straight from the source tree. All of them run on macOS and Linux. There is no Windows build yet.

Whichever route you pick, the AI engine needs credentials at runtime: either sign in with the `claude` CLI or put an `ANTHROPIC_API_KEY` in a `.env` file. See [System prerequisites](prerequisites.md) for the full dependency list.

## Option 1: npm (recommended)

Install the published package globally:

```bash
npm install -g @jairik/vault-assistant
```

Then start it:

```bash
vault-assistant          # web interface
vault-assistant --tui    # terminal interface
```

The server prints its address, `http://localhost:5173` by default. It does not open a browser for you, so paste the URL into one yourself. To use a different port, set `PORT` in a `.env` file.

One caveat: the `vault-assistant` command is a Bash wrapper around the project's `run.sh`, so you still need [Bun](https://bun.sh) 1.3 or newer on your `PATH`. The npm package gives you a convenient command; Bun does the actual work.

## Option 2: desktop app

Grab a package from the [latest GitHub release](https://github.com/Jairik/vault-assistant/releases/latest). Current formats are `.deb` and `.rpm` for Linux; macOS packages (`.dmg` for Apple Silicon and Intel) build in CI but have not shipped in a published release yet, so check the releases page for the current list.

The desktop app bundles its own Bun runtime as a sidecar, so this is the only install path that works without Bun on your system. You still need Claude Code credentials or an API key for generation. See [Desktop app](../interfaces/desktop-app.md) for how the shell works.

## Option 3: from source

Clone the repo and run the startup script:

```bash
git clone https://github.com/Jairik/vault-assistant.git
cd vault-assistant
./run.sh
```

`./run.sh` installs dependencies and starts the dev server, the same as running `bun install && bun run dev`. Add `--tui` to start the terminal interface instead. If you want the global `vault-assistant` command from a clone, run `npm install -g .` (or `bun install -g .`) from the repo root.

To build the desktop app from source you also need a Rust toolchain and a few system libraries; the list lives in [System prerequisites](prerequisites.md#desktop-application-requirements-tauri). Then:

```bash
bun run desktop        # run the desktop shell in dev mode
bun run desktop:build  # produce an installable package
```

## Next steps

Vault Assistant has three frontends that share one backend: the [web interface](../interfaces/web-app.md) (the default), the [desktop app](../interfaces/desktop-app.md), and the [terminal interface](../interfaces/tui.md). Pick whichever fits how you work.
