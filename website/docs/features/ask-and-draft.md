---
id: ask-and-draft
title: Ask and drafting features
---

# Ask and drafting features

Vault Assistant provides two primary modes for generating and refining text: **Ask the vault** and **Drafting mode**. Both modes query your vault files and stream answers back to the interface.

---

## Global header controls

The top bar of the application contains global settings that affect the entire interface:

1. **Theme toggle (☾/☀ button):** Located in the top right. Click this button to switch between dark and light modes. Low-level action: sets the `data-theme` attribute on the `<html>` element to `dark` or `light` and saves the selection in `localStorage` under the key `jt.theme`.
2. **Density toggle (▢/▣ button):** Adjusts layout spacing. Click to switch between compact and comfortable settings. Low-level action: sets the `data-density` attribute on the `<html>` element to `compact` or `comfortable` and saves the selection in `localStorage` under the key `jt.density`.
3. **Fun background selector (✨ button):** Cycles through animated canvas backgrounds. Low-level action: sets the `data-fun` attribute on the `<html>` element to `on` and activates the canvas rendering loop in [FunBackground.tsx](https://github.com/Jairik/vault-assistant/blob/main/src/components/FunBackground.tsx).
4. **Split view toggle (◫ button):** Splits the main screen into two parallel columns. Low-level action: toggles the split-pane layout state, saves the preference as `on` or `off` in `localStorage` under the key `jt.split`, and renders two independent `TabView` instances side by side.
5. **Shortcuts helper (? button):** Displays the keyboard shortcut overlay. Low-level action: sets the `shortcutsOpen` boolean to `true` in React state, showing a modal cheat sheet of key bindings.
6. **Settings panel button (⚙ button):** Opens the primary settings drawer. Low-level action: sets the `settingsOpen` boolean to `true` in React state to reveal the configuration panel.
7. **New Tab button (+):** Located next to the tab list. Click to append a fresh session tab. Low-level action: calls `newTab()` to add a new tab record to state, defaulting to your configured default tab mode.
8. **Tab close button (×):** Located on each tab label. Click to delete a session. Low-level action: removes the tab from state and deletes its active session ID from `.sessions.json` on the server.

---

## Mode bar controls

Each tab features a mode selector bar at the top of its editor panel:

1. **Ask the vault button:** Switches the tab to Ask mode. Low-level action: updates the tab record's `mode` attribute to `ask` in state. This hides the job description context field and targets the prompt at answering general queries.
2. **Drafting mode button:** Switches the tab to Drafting mode. Low-level action: updates the tab record's `mode` to `job`. This reveals the job description context field and configures the system prompt to write structured, first-person application answers.
3. **Write to vault button:** Switches the tab to Write mode. Low-level action: updates the tab record's `mode` to `write` and replaces the Ask/Draft editor card with the custom `VaultWriter` panel.
4. **Model/Engine badge:** Displays the active engine and model in the right corner. Hovering over the badge reveals the full engine name, model identifier, and reasoning level.

---

## Ask and drafting input cards

When a tab is in Ask or Drafting mode, the top half of the tab renders a card containing these inputs:

1. **Draft context / details textarea:** (Drafting mode only). Paste target job descriptions, experience requirements, or notes here. Low-level action: updates `tab.jobDescription` in state.
2. **Add additional context button (dropdown chevron):** (Drafting mode only). Located next to the Question label. Click to show a menu with two options:
   - **Additional text field:** Toggles `tab.extraContextOpen` to `true` to display a secondary text area for pasting additional background notes.
   - **Attach document (PDF / DOCX):** Triggers a hidden system file input. Selecting a file calls `handleFilePicked`. This uploads the file to `POST /api/attachments`. The server reads the bytes, extracts the text using Node parsing libraries, and writes the text to a temporary JSON record. The UI lists the file as an active attachment.
3. **Question textarea:** Enter the target question to answer. Low-level action: updates `tab.question` in state. Pressing `Enter` without modifiers triggers the generate action. Pressing `Shift` + `Enter` inserts a newline.
4. **Attachment remove button (× on attachment chips):** Located on each active document chip. Click to delete an attachment. Low-level action: removes the attachment ID from the tab's generation list and calls `DELETE /api/attachments/:id` to clear the temporary text file from the server.
5. **Ask / Generate / Regenerate button (Play icon):** Submits the prompt. Low-level action: POSTs to `/api/tabs/:id/generate`. The server resolves settings, parses attachments, index-scans vault files, calls the model, streams text deltas via Server-Sent Events, and runs the optional humanize pass.
6. **Stop button:** Appears only while a generation is running. Click to cancel. Low-level action: POSTs to `/api/tabs/:id/cancel` which calls `cancel()` in [runner.ts](https://github.com/Jairik/vault-assistant/blob/main/agent/runner.ts). This triggers `abort()` on the session's active `AbortController` signal, immediately killing the child CLI process or API stream.
7. **LaTeX toggle button:** Click to generate a formatted PDF. Low-level action: sets `tab.latex` to `true`. The server appends LaTeX instructions to the prompt, extracts the model's output code, compiles it using `tectonic --untrusted`, and caches the PDF.
8. **RAG toggle button:** Click to toggle Retrieval-Augmented Generation. Low-level action: sets `tab.rag` to `true`. Before generating, the server calls `retrieveForQuery` in [rag.ts](https://github.com/Jairik/vault-assistant/blob/main/agent/rag.ts) to score vault chunks using the BM25 algorithm, injecting only the top matches (~12 KB budget) into the prompt.
9. **Override toggle button:** Click to reveal tab-specific model settings. Low-level action: sets `tab.overrideEnabled` to `true`.
   - **Engine selector:** Selects a custom model provider. Low-level action: updates `tab.override.engine`.
   - **Model selector:** Selects a custom model ID. Low-level action: updates `tab.override.engineModels`. Selecting "Other..." reveals a text input to type custom model strings.
   - **Effort selector:** Selects a reasoning budget. Low-level action: updates `tab.override.engineReasoning`. Selecting "Other..." reveals a text input for custom reasoning settings.
   - **Vault / context repo path input:** Type an alternate vault directory. Low-level action: updates `tab.override.vaultDir`.
10. **Skills picker button:** Click to select which custom skills to apply. Low-level action: opens a dropdown selection menu listing all installed `SKILL.md` files. Selecting skills adds their names to the `tab.skills` array, and the server injects their instructions into the generation prompt.

---

## Answer area and follow-up actions

The bottom half of the tab displays the generated answer, execution logs, and follow-up controls:

1. **Format / Clean up button:** Located next to the generated response. Click to run the humanizer pass. Low-level action: POSTs to `/api/tabs/:id/cleanup` to feed the active response text back to the model with the `humanizer` skill instructions.
2. **Download .tex button:** (LaTeX mode only). Click to save the raw LaTeX code. Low-level action: triggers a browser download of the text stored in `tab.texSource`.
3. **Download .pdf button:** (LaTeX mode only). Click to save the compiled PDF. Low-level action: triggers a browser download pointing to `/api/latex/:id/pdf`.
4. **Recompile LaTeX button:** (LaTeX mode only). Appears next to the PDF log panel. Click to re-run compilation after editing the source code. Low-level action: POSTs the modified text to `/api/latex/compile` to execute the tectonic compiler again.
5. **+ New question button:** Located in the follow-up section. Click to clone the tab. Low-level action: calls `cloneTabForNewQuestion()` in [store.ts](https://github.com/Jairik/vault-assistant/blob/main/src/lib/store.ts). This creates a new tab with the same context details, attachments, and settings overrides to start a fresh chat branch.
6. **Follow-up input and send button (paper airplane icon):** Type refinement instructions and click send. Low-level action: POSTs to `/api/tabs/:id/message`. The server sends the text delta to the model along with the active session ID, allowing the model to refine its previous response.
