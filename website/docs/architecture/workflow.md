---
id: workflow
title: Developer Workflow (Quick Rules)
sidebar_label: Quick Rules
---

# Developer workflow

This file outlines the core rules for developing Vault Assistant. The full developer guide lives in the nested documentation folder at [development-workflow.md](development-workflow.md).

## Core rules

- **Test-driven development:** All new requests, features, or bug fixes must be accompanied by a test.
- **Running tests:** Execute `bun test` inside the repository root before finalizing any changes.
- **Safety checks:** Verify that file-writing paths do not escape the vault directory.
