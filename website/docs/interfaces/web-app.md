---
id: web-app
title: Web interface
---

# Web interface

The web interface is the default frontend. Starting the app in any form serves it: `vault-assistant` (or `./run.sh`) starts the Bun server and prints a local URL, `http://localhost:5173` unless you changed the port, and the [desktop app](desktop-app.md) wraps this same interface in its own window.

![The web interface with a tab in Ask mode](/img/screenshots/web-main-ask.png)

## First run

The first time you open the app, an onboarding wizard collects your name, your role, the absolute path to your vault, and optional voice notes about your tone. From those fields it builds the system prompts for Ask mode and Draft mode, which you can edit right in the wizard or later under Settings. You can also skip the whole thing and configure everything afterwards.

![The first-run onboarding wizard](/img/screenshots/web-onboarding.png)

After the wizard, a welcome walkthrough introduces the three modes. The same content stays available under Settings, on the Getting started page.

![The welcome walkthrough shown after onboarding](/img/screenshots/web-walkthrough.png)

## Tabs and sessions

The web interface is built around tabs. Each tab is an independent conversation with its own mode, question, context, and settings overrides, and generations in different tabs run concurrently.

1. **New Tab button (+):** Located next to the tab list. Click to append a fresh session tab. Low-level action: calls `newTab()` to add a new tab record to state, defaulting to your configured default tab mode.
2. **Tab close button (×):** Located on each tab label. Click to delete a session. Low-level action: removes the tab from state and deletes its active session ID from `.sessions.json` on the server.

You can rename tabs and give them colors to keep parallel work apart.

![Three tabs open with split view enabled](/img/screenshots/web-split-tabs.png)

## Global header controls

The top bar of the application contains global settings that affect the entire interface:

1. **Theme toggle (☾/☀ button):** Located in the top right. Click this button to switch between dark and light modes. Low-level action: sets the `data-theme` attribute on the `<html>` element to `dark` or `light` and saves the selection in `localStorage` under the key `jt.theme`.
2. **Density toggle (▢/▣ button):** Adjusts layout spacing. Click to switch between compact and comfortable settings. Low-level action: sets the `data-density` attribute on the `<html>` element to `compact` or `comfortable` and saves the selection in `localStorage` under the key `jt.density`.
3. **Fun background selector (✨ button):** Cycles through animated canvas backgrounds. Low-level action: sets the `data-fun` attribute on the `<html>` element to `on` and activates the canvas rendering loop in [FunBackground.tsx](https://github.com/Jairik/vault-assistant/blob/main/src/components/FunBackground.tsx).
4. **Split view toggle (◫ button):** Splits the main screen into two parallel columns. Low-level action: toggles the split-pane layout state, saves the preference as `on` or `off` in `localStorage` under the key `jt.split`, and renders two independent `TabView` instances side by side.
5. **Shortcuts helper (? button):** Displays the keyboard shortcut overlay. Low-level action: sets the `shortcutsOpen` boolean to `true` in React state, showing a modal cheat sheet of key bindings.
6. **Settings panel button (⚙ button):** Opens the primary settings drawer. Low-level action: sets the `settingsOpen` boolean to `true` in React state to reveal the configuration panel.

## Quick notes

Quick notes is a drawer for text you reuse often: profile links, professional references, and labeled note boxes. Everything in it lives in `localStorage` on your machine, and clicking an entry copies it to the clipboard. Open it with `Alt+N`.

![The quick notes drawer](/img/screenshots/web-quick-notes.png)

## Keyboard shortcuts

Press `?` anywhere outside a text field to open the shortcut overlay. The bindings accept both `Ctrl` and `⌘`:

| Shortcut | Action |
| -------- | ------ |
| `Enter` / `Shift + Enter` | Send / insert newline in the question field |
| `Ctrl + Enter` | Send from any field |
| `Ctrl + /` | Open the skills picker |
| `Ctrl/⌘ + ,` | Open or close Settings |
| `Ctrl/⌘ + \` | Toggle split view |
| `Ctrl/⌘ + .` | Cycle the active tab's mode (Ask → Draft → Write) |
| `Alt + 1` … `Alt + 9` | Jump to a tab by position |
| `Alt + T` | New tab |
| `Alt + W` | Close the active tab |
| `Alt + N` | Toggle quick notes |
| `Esc` | Close the open dialog |

![The keyboard shortcut overlay](/img/screenshots/web-shortcuts.png)

## Usage and logs

The Logs page in Settings lists recent generations with timing charts, so you can see how long answers take per engine. A usage widget shows provider usage for the selected engine and model when the engine exposes that information, including when the limit window resets.

![The logs page](/img/screenshots/web-logs.png)

## PDF preview

When a generation runs with the LaTeX toggle on, the web interface shows the compiled PDF inline, next to the compiler log. You can edit the LaTeX source and recompile without leaving the page, then download the `.tex` or `.pdf`. The controls are described in [Ask mode](../features/ask-mode.md#answer-area-and-follow-up-actions).

## What the other frontends share

The [desktop app](desktop-app.md) is this exact interface in a native window, so everything above applies there too. The [terminal interface](tui.md) covers the same three modes but drops the multi-tab workspace and visual extras; its page lists the differences.
