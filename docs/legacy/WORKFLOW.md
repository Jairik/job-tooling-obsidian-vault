# Vault Assistant Agent Workflow

Welcome to the **Vault Assistant** development guide! This document is designed to streamline the workflow for AI agents and developers working on this project.

## Core Architecture

Vault Assistant is a specialized web UI and backend system designed to harness various LLM CLIs (Command Line Interfaces) and external agents, seamlessly feeding them context from a user's vault (e.g., Obsidian) and displaying responses in a highly stylized, interactive interface.

### 1. CLI Engine Compatibility
The core strength of the Assistant is its ability to interface with multiple AI CLI tools:
- `Gemini Antigravity (agy)`
- `Claude` (via SDK)
- `OpenCode` (via `@opencode-ai/sdk` against a persistent `opencode serve` process, or the CLI directly)
- `Cursor Agent`
- `GitHub Copilot`
- `Codex` (via `@openai/codex-sdk`, or the CLI directly)

These engines are managed in `agent/cli-engines.ts`. The `runCliTurn` function is the unified executor that pipes standard input/output (or dispatches to a native SDK transport, for Codex and OpenCode) for any of the non-Claude agents. It automatically detects which tools are installed and available on the user's `PATH`.

### 2. UI and Styling
The UI is built with React. It supports dynamic background themes (found in `src/components/FunBackground.tsx`) and CSS-driven layout management.
- **Settings:** Organized logically into sub-headings (`General Preferences`, `AI Engine & Models`, `Generation & Retrieval`, `Vault & Context`, `Persona Prompt`).
- **Fun Backgrounds:** A variety of canvas-based background renderers and CSS themes (e.g., Balatro, Matrix Rain, Aurora). Changes to these are applied via `data-` attributes on the `document.documentElement`.

## Development Workflow

### Test-Driven Development (CRITICAL)
**All new requests and features must be accompanied by a test.**

We utilize `bun test` as our primary testing framework. The core testing suite is located in `agent/agent.test.ts`. 
When you add a new feature (such as a new CLI engine, a new prompt builder, or modifying execution logic), you *must* add or update a test in the suite to audit that the feature works accordingly.

1. **Write the Code:** Implement your feature or bug fix.
2. **Update the Tests:** Open `agent/agent.test.ts` and add a new `test(...)` block or update an existing one to cover your changes.
3. **Run the Tests:** Execute `bun test` to ensure your new test passes and no existing tests are broken.

### Adding a New CLI Engine
1. Update the `engines` type/array in `src/lib/store.ts`.
2. Add detection logic in `agent/cli-engines.ts` (`cliAvailable` function).
3. Ensure the unified `runCliTurn` executor can handle the new engine's I/O structure.
4. **Update `agent/agent.test.ts`** to audit the new engine detection and execution logic.

### Adding a New Fun Background
1. Add the rendering logic (Canvas or CSS) to `src/components/FunBackground.tsx` and `src/styles.css`.
2. Update the `FunVariant` type in `src/lib/store.ts`.
3. Ensure the Settings panel (`src/components/SettingsPanel.tsx`) lists the new background.

## Best Practices
- **Documentation:** Keep this workflow document updated if architectural shifts occur.
- **CSS Checks:** Always verify that layout structure (like the settings drawer) is not broken when introducing new UI elements or themes.
