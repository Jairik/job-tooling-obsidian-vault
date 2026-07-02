---
id: introduction
title: Introduction
---

# Introduction

Vault Assistant is a local application that drafts grounded, natural text based on files in your Obsidian vault. The application serves both a React web interface and a terminal interface (TUI) from a single Bun process.

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

## Quick start

To start the default web application and API server:

```bash
./run.sh
```

To run the server with hot reloading enabled for development:

```bash
bun run dev
```

To run the terminal interface:

```bash
bun run tui
```
