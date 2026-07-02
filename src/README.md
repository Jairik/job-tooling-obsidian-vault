# React Web Frontend (`/src`)

This directory contains the source code for the Web UI. It is built as a single-page application using React, Vite, and Vanilla CSS.

## Structure

- **`main.tsx`**: Entry point for mounting the React application to `index.html`.
- **`App.tsx`**: The main interface coordinator. Handles the top navigation, multi-tab state, layouts, and panels.
- **`styles.css`**: The core styling file containing responsive grid coordinates, font hierarchies, color variables, and interactive micro-animations.

### Subdirectories

- **`/components`**: Reusable interface components:
  - `SettingsPanel.tsx`: Controls general settings, model selection, persona prompt templates, and active engines.
  - `FunBackground.tsx`: Coordinates Canvas/CSS rendering for dynamic background styles (e.g. Matrix Rain, Balatro, Aurora).
  - `VaultWriter.tsx` & `QuickNotes.tsx`: Interactive drafts, document summaries, and fill-in guides.
  - `AnswerStream.tsx` & `LogsView.tsx`: Live stream components rendering model responses and tool-use steps.
  - `HelpGuide.tsx` & `ShortcutsOverlay.tsx`: Keyboard shortcuts and help panels.
  
- **`/lib`**: Helper utilities and client state:
  - `store.ts`: LocalStorage persistence layer and reactive state container for tabs, settings, and documents.
  - `api.ts`: API client interfacing with the Bun server backend.
  - `shortcuts.ts`: Hook for managing global hotkeys.
  - `fonts.ts`: Manages dynamic Google Fonts integrations based on configuration settings.
