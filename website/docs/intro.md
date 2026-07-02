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
- [System prerequisites](getting-started/prerequisites.md) : Required tools, optional engine CLIs, and Tauri desktop compilation.

## Application features

- [Ask and drafting modes](features/ask-and-draft.md) : Creating answers, toggling LaTeX formatting, and attaching context documents.
- [Write to vault](features/write-vault.md) : Auto-placing notes, scanning vault gaps, proposing document writes, and the write approval flow.
- [RAG retrieval](features/rag.md) : Local BM25 indexing, token optimization, and context selection.
- [Local web research](features/web-research.md) : Integrating SearXNG, crawler resolution modes, and IP security checks.
- [Custom skills](features/skills.md) : Skill directories, YAML formatting rules, and the interactive skill generator.
- [Settings panel features](features/settings.md) : Page list, folder validators, skill creators, and color appearance sliders.

## Technical architecture

- [Architecture overview](architecture/overview.md) : Process layout, request pipelines, and CLI sandbox execution.
- [Design system and interface styling](architecture/design-system.md) : OKLCH tokens, layout themes, and density scales.
- [Developer workflow and guidelines](architecture/development-workflow.md) : Running tests, adding engines, and editing rules.
