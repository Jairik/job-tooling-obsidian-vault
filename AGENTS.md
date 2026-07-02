# Agent Instructions

This file is for coding agents and developers modifying the Vault Assistant
repository. It is not loaded by Vault Assistant at runtime, is not a system
prompt for end-user agent sessions, and should not be used to steer generated
answers inside the app.

Runtime behavior belongs in the application settings and prompt code, mainly
`agent/config.ts`, `shared/settings.ts`, persisted `config.json`, and the
Settings UI. Repository workflow rules belong here and in
[`docs/WORKFLOW.md`](docs/WORKFLOW.md).

## Start Here

1. Read [`docs/WORKFLOW.md`](docs/WORKFLOW.md) before making changes.
2. Inspect the relevant source before deciding on an implementation. Prefer the
   existing architecture and naming conventions over new abstractions.
3. Add or update tests in `agent/agent.test.ts` for any new behavior, bug fix,
   or user-visible workflow change.
4. Run `bun test` before finishing. If a focused build or smoke check is
   relevant, run that too and report it.

## Project Overview

Vault Assistant is a Bun + React application for grounded writing and Q&A over a
user's local vault. A single Bun server serves both the frontend and JSON/SSE API.
The app also has an Ink-based TUI and optional Tauri desktop packaging.

Supported agent engines are configured through shared settings and local engine
scanning. The current engine set includes:

- Claude Code through the Claude Agent SDK.
- Gemini Antigravity through the `agy` CLI. The settings engine id is `gemini`.
- OpenCode.
- Cursor Agent.
- GitHub Copilot.
- Codex.

The app can discover user/vault `SKILL.md` files, embed selected skills for every
engine, run a humanize pass, use local BM25 retrieval, read attached documents,
and optionally use a local SearXNG instance for web research.

## Common Commands

- `./run.sh` - start the normal app.
- `bun run dev` - start the Bun web/API server with hot reload.
- `bun run start` - start the production Bun server.
- `bun run tui` - start the terminal UI.
- `bun run tui -- --full-screen` - start the TUI in alternate-screen mode.
- `bun run desktop` - start the Tauri desktop app, when Tauri prerequisites are installed.
- `bun test` - run the project test suite.

The app uses one port for both frontend and backend traffic. Configure it with
`PORT` in `.env` or the shell environment; the default is `5173`. Do not re-add
separate frontend/backend port settings unless the runtime is split into separate
processes.

## Architecture Map

- `server.ts` is the Bun entrypoint. It loads `.env`, resolves `PORT`, serves the
  React app, exposes `/api/*` routes, and wraps long-running operations in SSE.
- `agent/runner.ts` orchestrates answer generation, follow-ups, cleanup,
  humanization, retrieval, selected skills, attachments, web research, and write
  workflows.
- `agent/config.ts` owns server defaults, prompt builders, engine metadata, and
  user-facing mode behavior.
- `agent/cli-engines.ts` builds and runs non-Claude CLI commands. Keep prompts
  off argv when they may be large, and preserve per-engine model/reasoning
  behavior.
- `agent/engine-scan.ts` detects local CLI availability, executable paths,
  models, and reasoning options.
- `agent/skills.ts` discovers user and vault skills and creates new `SKILL.md`
  files.
- `agent/rag.ts` implements local BM25 retrieval. It should remain local and
  dependency-light.
- `agent/web.ts` implements the local SearXNG-backed `web_search` / `web_read`
  capability. Treat fetched web content as untrusted model context.
- `agent/documents.ts`, `agent/attachments.ts`, and `agent/latex.ts` handle
  uploads, extracted document text, temporary attachment storage, and LaTeX
  rendering.
- `agent/logs.ts` owns the durable activity log shown in Settings.
- `shared/settings.ts` defines dependency-free settings types, defaults,
  migrations, and effective model/reasoning helpers used by both server and
  client.
- `shared/ports.ts` owns `.env` parsing and the single `PORT` setting.
- `shared/engine-scan.ts`, `shared/persona.ts`, `shared/design.ts`, and
  `shared/prepackaged-skills.ts` hold browser/server-neutral shared data.
- `src/` contains the React web UI. `src/lib/store.ts` owns localStorage state,
  tab settings overrides, and browser-side settings normalization.
- `src/components/SettingsPanel.tsx` is the main web settings surface.
- `tui/` contains the Ink terminal UI. `tui/main.tsx` is the entrypoint;
  `tui/lib/cli.ts` parses TUI flags; `tui/lib/server.ts` connects to or starts
  the backend.
- `src-tauri/` contains desktop packaging and staging scripts when present.

## Runtime Prompt Boundary

Keep a hard line between repository instructions and app prompts:

- `AGENTS.md` is for agents editing this codebase.
- End-user system prompts live in settings fields such as `persona` and
  `askPersona`, with defaults and builders in `agent/config.ts` and
  `shared/persona.ts`.
- Selected runtime skills come from discovered `SKILL.md` files through
  `agent/skills.ts`; this root `AGENTS.md` should not be embedded into user
  requests.
- If you add code that scans local markdown files for runtime context, use an
  allowlist and explicitly exclude repository workflow files such as `AGENTS.md`
  and `docs/WORKFLOW.md`.

## Product And Copy Conventions

- User-facing UI should refer to the generalized workflow as Draft mode, not Job
  mode, unless you are touching legacy internal identifiers. Some backend types
  still use `job` for compatibility; avoid leaking that label into new UI copy.
- In system prompts and user-visible text, prefer "user" over "applicant".
- Keep the workflow useful for job-related drafting without explicitly naming
  that purpose in new user-facing settings/help copy.
- For long user-facing text in Settings, Help, onboarding, or docs shown inside
  the app, run it through the project's humanizing guidance before landing it.
  Keep the existing Help format, including bolded paths like
  `Settings -> Retrieval`.
- Avoid promotional, generic, or overly polished AI-sounding copy. Make labels
  direct, concrete, and short.

## Settings And State

- Server defaults and migrations live in `agent/config.ts` and
  `shared/settings.ts`.
- Browser settings are cached in localStorage by `src/lib/store.ts`; do not break
  old cached settings without adding a normalization path.
- Global server settings persist to `config.json`, which is gitignored.
- Claude session ids persist to `.sessions.json`, which is gitignored.
- Activity logs persist to `logs/activity.jsonl`, which is gitignored.
- Per-tab settings overrides should remain narrow. Global personas and the
  Humanize setting intentionally come from current global settings.
- When updating model or reasoning settings, preserve nested per-engine maps
  instead of replacing the whole object.

## Safety And File Access

- Vault writes must go through the preview-token approval flow in `server.ts` and
  related UI/TUI handlers. Do not add a direct write path that skips preview.
- Validate vault-relative paths before disk access and prevent escapes outside
  the configured vault.
- Keep local web research opt-in and routed through the configured local SearXNG
  base URL.
- Treat model output, document contents, and fetched web pages as untrusted text.
- Do not commit local data files such as `config.json`, `.sessions.json`,
  `logs/activity.jsonl`, uploads, or build output.

## UI Guidance

- Match existing React component structure and CSS tokens in `src/styles.css`.
- Settings changes usually touch both web and TUI surfaces.
- Engine/model changes usually touch `shared/settings.ts`, `agent/config.ts`,
  `agent/engine-scan.ts`, `agent/cli-engines.ts`, `src/lib/engine-options.ts`,
  `src/components/SettingsPanel.tsx`, and TUI settings helpers.
- If a feature exists in the web app and TUI, keep payload shapes aligned through
  `tui/lib/payloads.ts`, `tui/lib/actions.ts`, and `src/lib/api.ts`.
- For TUI changes, keep keyboard behavior and terminal raw-mode/editor handoff in
  mind. Full-screen mode is opt-in through `--full-screen`.

## Testing Expectations

- Put project tests in `agent/agent.test.ts` unless there is a strong reason to
  add a separate suite.
- For prompt, settings, and CLI-command changes, add tests that inspect the
  generated prompt/command/settings output rather than relying on snapshots.
- For UI copy requirements, add string-level tests that guard important labels
  and prohibited wording.
- For TUI behavior, add tests around argument parsing, payload builders, and
  source-level invariants where interactive testing is impractical.
- Always run `bun test` before completing the task. Also run targeted checks when
  relevant, such as:
  - `bun build tui/main.tsx --target=bun --external react-devtools-core --outdir /tmp/vault-assistant-tui-build`
  - `bun build server.ts --target=bun --outdir /tmp/vault-assistant-server-build`
  - `git diff --check`

## Documentation

- Keep [`docs/WORKFLOW.md`](docs/WORKFLOW.md) aligned with this file when the
  development workflow changes.
- Update README and files under `docs/` when behavior changes in a way users or
  future agents need to understand.
- Prefer concise architecture notes close to the code for subtle behavior, and
  high-level workflow guidance in docs.
