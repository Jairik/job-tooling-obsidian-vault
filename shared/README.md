# Shared Directory (`/shared`)

This directory contains code and types that are shared between the Web UI (`/src`), the Terminal User Interface (`/tui`), and the Bun backend agent server (`/server.ts` and `/agent`).

To ensure that both environments can import these files without conflicts, all modules in this directory must remain **dependency-free** and avoid importing any node-specific or browser-specific modules.

## Contents

- **`design.ts`**: Lists custom canvas and CSS visual configurations (e.g. animated backgrounds like Balatro, Matrix Rain) used by both the Web UI and settings storage.
- **`persona.ts`**: Handles persona configurations, user profiles, and helper functions to build custom prompts from persona notes.
- **`prepackaged-skills.ts`**: Declares built-in skills (like "Humanize" and "Web-search research") that are integrated into CoreSettings.
- **`settings.ts`**: Declares default settings, reasoning/model parameters, and type specifications for settings data structures.
- **`usage.ts`**: Shared usage structure definitions and parser helpers.
