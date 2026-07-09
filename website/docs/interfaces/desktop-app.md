---
id: desktop-app
title: Desktop app (Tauri)
---

# Desktop app (Tauri)

The desktop app is the [web interface](web-app.md) in a native window. It exists for people who want a dock icon and a standalone window instead of a browser tab. Feature-wise the two are identical.

## How it works

The app is a [Tauri](https://tauri.app) shell around the normal Vault Assistant server. On launch it:

1. Starts a bundled Bun runtime as a sidecar process, which runs the same `server.ts` that `vault-assistant` runs.
2. Waits for the server's ready message.
3. Points its webview at the local address.

Nothing is reimplemented for the desktop build. The sidecar serves the same API and the same React frontend, so features land in both at the same time.

Because Bun ships inside the bundle, this is the one install path that does not require Bun on your system. Claude Code credentials (or an `ANTHROPIC_API_KEY`) are still required for generation, the same as every other frontend.

## Installing

Download a package from the [latest GitHub release](https://github.com/Jairik/vault-assistant/releases/latest). Current formats are `.deb` and `.rpm` for Linux. macOS packages (`.dmg` for Apple Silicon and Intel) build in CI but have not shipped in a published release yet, and there is no Windows build. The [Installation](../getting-started/installation.md) page compares this route with npm and source installs.

## Building from source

The desktop build needs a Rust toolchain and a few system libraries on Linux; see [System prerequisites](../getting-started/prerequisites.md#desktop-application-requirements-tauri). With those in place:

```bash
bun run desktop        # dev mode with a live window
bun run desktop:build  # produce installable packages
```

The build stages a bundled copy of the server and your host's Bun binary into the app package, so the result runs on machines without any of the development tooling.
