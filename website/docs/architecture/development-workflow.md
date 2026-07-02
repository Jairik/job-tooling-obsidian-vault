---
id: development-workflow
title: Developer workflow and guidelines
---

# Developer workflow and guidelines

This page outlines the development process, testing requirements, and coding conventions for adding features or modifying the Vault Assistant codebase.

## Repository layout

Before making changes, inspect the file mappings:
- `server.ts` handles the Bun entrypoint, routes static React files, exposes the JSON/SSE API endpoints, and validates vault paths.
- `agent/runner.ts` manages the text generation pipeline, follow-up messages, session cancellation, and LaTeX rendering.
- `agent/cli-engines.ts` builds CLI command arguments and executes non-Claude models in temporary directories.
- `agent/engine-scan.ts` scans the system `PATH` to locate installed agent executables and query available models.
- `agent/skills.ts` discovers custom user or vault skills and runs the assistant skill generator.
- `agent/rag.ts` implements the local BM25 indexing and document scoring.
- `agent/web.ts` manages the local SearXNG search connection and page crawler modes.
- `shared/settings.ts` defines the configuration schemas and default values used by the server and browser.
- `src/` contains the React frontend app.
- `tui/` contains the terminal user interface code.

---

## Test-driven development

You must write or update tests for any bug fixes, setting changes, or new feature additions.

The project uses `bun test` as its testing framework. The test suite is located in `agent/agent.test.ts`. 

To run the complete test suite:
```bash
bun test
```

### Adding tests

When you add a new feature, open `agent/agent.test.ts` and add a matching test block. 
- Assert that model prompt strings contain the correct instruction blocks.
- Verify that setting updates normalize and backfill missing keys.
- Avoid using snapshot tests. Inspect the actual output values or configuration fields instead.

---

## Adding a new CLI engine

To add support for a new model CLI:
1. Update the `engines` configuration map in `src/lib/store.ts` and `agent/config.ts`.
2. Add binary detection logic to the `cliPathForEngine` function in `agent/engine-scan.ts`.
3. Add a command builder block inside the `buildCliCommand` function in `agent/cli-engines.ts` to construct the CLI argument list and configure input piping.
4. Add a test in `agent/agent.test.ts` to verify engine detection and argument building.

---

## Adding a new fun background variant

To add a new background animation:
1. Add the Canvas or CSS rendering logic inside `src/components/FunBackground.tsx`.
2. Define the new variant identifier in the `FunVariant` type inside `src/lib/store.ts`.
3. Register the new background option in the settings appearance list in `src/components/SettingsPanel.tsx`.

---

## Coding conventions

- **Safety first:** Ensure all vault-relative file access paths resolve inside the configured vault directory. Prevent escapes or relative directory traversals.
- **Active voice:** Write descriptive labels, code comments, and documentation using active verbs.
- **Durable settings:** Keep persona settings and file paths neutral. If you update setting definitions, add default values or normalization routes in `shared/settings.ts` to avoid breaking existing user configurations stored in browser cache or local JSON files.
- **UI consistency:** Follow the styling tokens and components defined in `src/styles.css`. Ensure new UI elements scale correctly under both comfortable and compact density settings.
