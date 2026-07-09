---
id: intro
title: Vault Assistant Documentation
slug: /
sidebar_label: Home
---

# Vault Assistant Documentation

Welcome to the Vault Assistant documentation. This guide details how the application works, how to configure its features, and how to contribute to its development.

## Getting started

- [Introduction](getting-started/introduction.md) : Overview of the project, capabilities, and quick startup.
- [Installation](getting-started/installation.md) : Installing from npm, downloading the desktop app, or running from source.
- [System prerequisites](getting-started/prerequisites.md) : Required tools, optional engine CLIs, and desktop build dependencies.

## Interfaces

- [Web interface](interfaces/web-app.md) : The default frontend, with tabs, split view, quick notes, and keyboard shortcuts.
- [Desktop app (Tauri)](interfaces/desktop-app.md) : The same interface in a native window, with a bundled runtime.
- [Terminal interface (TUI)](interfaces/tui.md) : The full workflow from a terminal, and how it differs from the web interface.

## Application features

- [Ask mode](features/ask-mode.md) : Asking grounded questions, generation toggles, and the answer area.
- [Draft mode](features/draft-mode.md) : Drafting first-person text from a job description and attached documents.
- [Write to vault](features/write-vault.md) : Auto-placing notes, scanning vault gaps, proposing document writes, and the write approval flow.
- [RAG retrieval](features/rag.md) : Local BM25 indexing, token optimization, and context selection.
- [Local web research](features/web-research.md) : Integrating SearXNG, crawler resolution modes, and IP security checks.
- [Custom skills](features/skills.md) : Skill directories, YAML formatting rules, and the interactive skill generator.
- [Settings panel features](features/settings.md) : Page list, folder validators, skill creators, and color appearance sliders.

## Technical architecture

- [Architecture overview](architecture/overview.md) : Process layout, request pipelines, and CLI sandbox execution.
- [Design system and interface styling](architecture/design-system.md) : OKLCH tokens, layout themes, and density scales.
- [Developer workflow and guidelines](architecture/development-workflow.md) : Running tests, adding engines, and editing rules.
