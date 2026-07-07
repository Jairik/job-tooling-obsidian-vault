# Vault Assistant

A multi-tab web UI for asking questions about your Obsidian vault with Claude Code
(Sonnet, medium reasoning) instances, grounded in what the vault actually says.
Each tab is an independent conversation: type a question, hit **Ask**, edit the
answer in place, and tweak it with follow-ups.

A separate **Job mode** (per-tab toggle) switches to the original workflow: paste a
job description + a question and draft a grounded, humanized first-person
job-application answer.

## Run it

### Local Development / Repository Run

To run it directly from the cloned repository:

```bash
./run.sh
```

That's it. Open http://localhost:5173.

(Equivalent: `bun install && bun run dev`.)

### Global Installation (CLI)

You can install the package globally using `npm` or `bun`:

```bash
# From the repository root
npm install -g .
# or
bun install -g .
```

Once installed globally, you can run Vault Assistant from any directory:

* **Start the Web UI & server**:
  ```bash
  vault-assistant
  ```
* **Start the Terminal UI (TUI)**:
  ```bash
  vault-assistant --tui
  ```

To change ports, add a local `.env` file:

```bash
PORT=5173
```

The app serves the frontend and API from the same Bun process, so one port is
used for both.

By default, Vault Assistant stores `config.json`, `logs/`, and `.attachments/`
next to wherever it's installed. If that install location isn't writable
(common for a global npm/bun install under a system-managed prefix, e.g. one
installed with `sudo`), it automatically falls back to a per-user data
directory (`~/.local/share/vault-assistant` on Linux, `~/Library/Application
Support/vault-assistant` on macOS).
Set `VA_DATA_DIR` to override this location explicitly.

### First-run setup
The first time you open the app (when there's no `config.json` yet) a short setup
modal asks for your **name**, **role**, **vault path**, and optional **voice notes**,
then generates a personalized system prompt from them. Everything is editable later
under **Settings → Persona** (with a "Regenerate system prompt from profile" button),
and your answers are saved to `config.json`, which is gitignored and so survives
`git pull` updates. Press **Skip** to start with a neutral default prompt.

### Requirements
- [Bun](https://bun.sh) (1.3+)
- Claude Code installed and logged in (the app reuses your existing auth — no API
  key needed). If you are not logged in, set `ANTHROPIC_API_KEY` in `.env`.

## Modes

Each tab is either **Ask** (the default) or **Job**, switched with the toggle in the
tab's header. A small icon on every tab shows which mode it's in, and the Settings
drawer has a checkbox to choose the default mode for new tabs.

### Ask mode (default)
A Claude Code instance reads the relevant files in your vault and answers your
question directly, grounded in what it finds — nothing fabricated. When the
**Humanize** skill is on (the default) the answer also gets a de-AI rewrite pass.
Follow-ups resume the same session.

### Job mode
The original job-application workflow:
1. **Draft** — reads the vault (`JJ-master/Projects`, `Background`,
   `Leadership-Examples`, etc.) and writes a grounded, first-person answer.
2. **Humanize** — when the **Humanize** skill is on (default), the `humanizer` skill is
   run on the draft; the humanized version becomes the final answer (the raw draft stays
   in a collapsible panel).
3. **Follow-ups** — type tweaks ("make it shorter", "lead with the Lunara project")
   and the same session is resumed.

## Editing & Clean up

Generated answers are **editable in place** — just click into the answer and type;
edits persist with the tab. Two icons on the answer card:
- **↻ Regenerate** — re-runs generation from the current inputs.
- **✨ Clean up** — sends the current (possibly hand-edited) answer to the selected
  **cleanup model** that fixes grammar and polishes the writing
  with the `humanizer` skill (inline rules when the skill isn't installed). It runs
  on a throwaway turn and won't disturb the tab's follow-up session.

### Tabs & concurrency
Spawn as many tabs as you want; each runs its own Claude Code instance and can
generate concurrently. Tabs and settings persist across reloads (localStorage);
sessions persist server-side so follow-ups survive a restart.

### RAG checkbox (minimize tokens)
Checking **RAG** retrieves only the most relevant slices of your vault for the
current job description + question and sends just those to the model, instead of
letting the agent read the whole vault (Claude) or dumping every file into the
prompt (Gemini). Fewer input tokens, same grounding.

It's BM25 retrieval implemented in pure Bun/TypeScript (`agent/rag.ts`) — no
embeddings service, no API keys, nothing to install. The retrieved files/headings
show up in the tab's **Context activity** log. There's a per-tab toggle in the
controls row (available in both modes) and a global default in Settings; new tabs
inherit the global default. If a query matches nothing, RAG steps aside and the
normal full-vault path runs. See [`docs/rag.md`](docs/rag.md) for details.

### YC checkbox (Job mode)
In **Job mode**, checking **YC** uses a `yc-combinator` skill to shape the answer
for a Y Combinator application. That skill is not installed yet, so the checkbox
currently shows a "skill not found" note and generates normally. Drop a skill at
`~/.claude/skills/yc-combinator/SKILL.md` (or `<vault>/.claude/skills/...`) and it
activates automatically for every supported agent — no code change.

## Engines

Answers can be generated by either engine, set globally or per-tab (default Claude):
- **Claude Code** — uses the Claude Agent SDK (Sonnet, medium reasoning) with the
  real `humanizer` skill and session-based follow-ups.
- **Gemini Antigravity** — shells out to the `agy` CLI in your vault. Model and
  reasoning effort don't apply; humanization uses inline rules (no Skill tool), and
  follow-ups pass the prior answer in the prompt. Requires `agy` on your PATH.

Every user-selected `SKILL.md` is embedded in the request sent to Claude Code and
each CLI engine, so skills work consistently without installing them separately for
Codex, Antigravity, Cursor, Copilot, or OpenCode.

**Pre-packaged skills** ship with the app and are toggled globally under **Settings →
Skills**, separately from your installed user skills: **Humanize** (de-AI rewrite,
default on — disabling may speed responses up at some quality cost; applies to every
mode) and **Web-search research** (the on-demand local web search below). Your own
discovered `SKILL.md` files are listed under "User skills" on the same page.

## Free local web research

Optionally run a local [SearXNG](https://docs.searxng.org/) instance and enable
**Local web research** in Settings → Retrieval. Every agent then shares the same
bounded `web_search` / `web_read` capability. Search uses SearXNG, normal pages
use Mozilla Readability, and JavaScript-heavy pages can fall back to local
Chromium—no paid API, hosted reader, or agent-specific MCP configuration.

The app validates every requested public URL, re-checks redirects, limits response
sizes, and sends web content back to the model as untrusted data. Setup and
limitations: [docs/web-research.md](docs/web-research.md).

## Tab names & colors

Each tab gets a distinct accent color and an auto-generated name: a colorful
codename until you add content, then a title derived **fully offline** from the job
description (the company name when one is detectable) or the question. Double-click
a tab to rename it; manual names stick.

## Settings (gear icon)

Everything is configurable, globally and per-tab:
- **Default mode for new tabs** (Ask / Job)
- **Engine** (Claude Code / Gemini Antigravity)
- **Model** (configurable per engine)
- **Cleanup model** (lightweight model for the **Clean up** button; configurable per engine)
- **Reasoning effort** (main and cleanup reasoning, configurable per engine where supported)
- **Humanize** pre-packaged skill on/off (all modes; default on — under Skills)
- **Web-search research** pre-packaged skill on/off (under Skills; SearXNG URL under Retrieval)
- **RAG** retrieval on/off (default for new tabs; minimizes tokens)
- **URL fetch method** (Readability, automatic Chromium fallback, or Chromium)
- **Vault / context repo** path (+ extra context dirs) with live validation
- **Profile** (name / role / voice notes) used to generate the system prompt
- **Persona / system prompt** (the Job-mode grounding instructions)
- **Max turns**

The **Logs** page (under Settings) shows the durable activity history — events,
tool calls, answers, and timing/engine charts — with a single action to clear it.

## Config & data files
- `config.json` — saved global settings (gitignored)
- `.sessions.json` — tab → Claude Code session id map (gitignored)
- `logs/activity.jsonl` — durable activity log shown in Settings → Logs (gitignored)

## Appearance
The UI ships a polished design system: OKLCH-token theming with **dark** (default)
and **light** modes (☾/☀ in the header), a **compact density** toggle (▢/▣),
**split view** (◫) for two panes side by side, a **fun mode** (✨) with cyclable
animated backgrounds, status pills, segmented chips, and a live status bar.
Preferences persist across reloads. See [`docs/design.md`](docs/design.md).

## Documentation
High-level docs live in [`docs/`](docs/):
- [`docs/README.md`](docs/README.md) — what this is, at a glance
- [`docs/architecture.md`](docs/architecture.md) — how a request becomes an answer
- [`docs/rag.md`](docs/rag.md) — the RAG retrieval feature
- [`docs/web-research.md`](docs/web-research.md) — no-key web search and content resolution
- [`docs/design.md`](docs/design.md) — the design system and theming
