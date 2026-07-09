---
id: introduction
title: Introduction
---

# Introduction

Vault Assistant is a local application that drafts grounded, natural text based on files in your Obsidian vault. A single Bun process serves a React web interface and a terminal interface (TUI), and an optional desktop app wraps the web interface in a native window.

## What it does

When you paste a prompt or a specific question, the application:

1. Gathers context directly from your local vault files.
2. Drafts an answer in your personal style using your chosen local or API-based model.
3. Automatically runs a humanizing step to remove common AI writing patterns.

Each session or tab in the interface acts as an independent conversation. You can refine drafts using follow-up text prompts.

## Core concepts

- **Grounded context:** The model does not make up facts. It uses only the information found inside your vault. If your vault lacks details to support a claim, the application leaves it out.
- **Single process runtime:** A single Bun server hosts the frontend static files, handles the JSON/SSE API routes, and manages the local model executables.
- **RAG mode for token savings:** You can switch on RAG (Retrieval-Augmented Generation) for any tab. When RAG is active, the system indexes your vault and sends only the most relevant excerpts to the model rather than reading the entire vault.
- **Local privacy:** Your vault contents never leave your machine. The application runs local CLI models or uses your existing Claude Code credentials directly.

## Three ways to use it

One backend serves three frontends. The [web interface](../interfaces/web-app.md) is the default and has every feature, including tabs, split view, and quick notes. The [desktop app](../interfaces/desktop-app.md) wraps that same interface in a native window with a bundled runtime. The [terminal interface](../interfaces/tui.md) covers the core workflow from a shell, with a few of the visual features left out.

## Quick start

The fastest route is the npm package:

```bash
npm install -g @jairik/vault-assistant
vault-assistant
```

Then open the printed URL, `http://localhost:5173` by default. Add `--tui` for the terminal interface. The [Installation](installation.md) page covers this route in detail, plus the desktop app download and running from source.

From a source checkout, `./run.sh` starts the same server (`bun run dev` for hot reloading, `bun run tui` for the terminal interface).
