# Terminal User Interface (`/tui`)

This directory contains the source code for the Terminal User Interface (TUI). It is built using React and **Ink** to render interactive terminal layouts.

## Structure

- **`main.tsx`**: The main entry point for launching and rendering the Ink application. Orchestrates central loop states, keyboard events, screen selection, and view focus management.

### Subdirectories

- **`/components`**: Reusable console components:
  - `Header.tsx` & `StatusBar.tsx`: Visual framing, active modes, and helper hotkey overlays.
  - `ConversationView.tsx`: Screen for inputting prompts, showing live-stream responses, and editing answers in general Ask or Job mode.
  - `WriteView.tsx`: Interface for vault draft management, manual text layouts, and prompt compilation.
  - `ApprovalView.tsx`: Terminal diff viewer and review prompt before writing proposed changes to disk.
  - `SettingsView.tsx`: Manage environment paths, selected models, and global parameters.
  - `SkillsView.tsx`: Shows discovered `.md` skills and their active status.
  - `LogsView.tsx`: Renders backend debug activity and execution traces.
  - `AttachView.tsx`: Lists and manages file attachments uploaded for context processing.

- **`/lib`**: Helper utilities and TUI specific API drivers:
  - `cli.ts`: Parses CLI startup arguments (e.g. `--port`, `--server-url`, `--mode`).
  - `api.ts`: Event streams and client-to-server request wrappers.
  - `server.ts`: Verifies connectivity to the backend and automatically spawns a local server if needed.
  - `actions.ts`: Core application action handlers (triggering runs, accepting diff proposals, saving settings).
  - `editor.ts` & `clipboard.ts`: Integrations with default CLI editors (`nano`/`vim`/`vis`) and system clipboard providers.
  - `session.ts`: State representation for active prompts, selections, and execution phases.
  - `modes.ts`: Map definitions and helper utilities for TUI modes (`ask` | `draft` | `write`).
  - `use-terminal.ts`: Hook for tracking raw terminal dimensions to adapt layouts.
