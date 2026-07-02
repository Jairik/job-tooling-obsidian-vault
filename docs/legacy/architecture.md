# Architecture

A short tour of how a request becomes an answer.

## Process model

One Bun process does everything:

- `Bun.serve` in `server.ts` serves the React app (`src/index.html`, bundled by
  Bun) and a small API.
- The same process runs the agent pipeline in `agent/runner.ts`.
- Long generations stream back to the browser as Server-Sent Events (SSE).

There is no separate build step and no database. Global settings live in
`config.json`; the tab-to-session map lives in `.sessions.json`; the activity log
is appended to `logs/activity.jsonl` (all gitignored).

## A request, end to end

1. **UI** — `src/App.tsx` holds the tabs. Each tab has a job description, a
   question, a per-tab **Skills** selection (which installed skills to apply),
   and per-tab toggles (**RAG**, settings override). Hitting Generate POSTs to
   `/api/tabs/:id/generate`.
2. **Server** — `server.ts` merges the global config with any per-tab override,
   then calls `generate()` and wraps the result in an SSE stream.
3. **Pipeline** — `agent/runner.ts` runs the turns:
   - **Draft turn** — writes a grounded first-person answer.
   - **Humanize turn** — runs the `humanizer` skill on the draft (if enabled).
   - Follow-ups resume the same session so context is preserved.
   - When local web research is enabled, an engine can request up to four
     mediated SearXNG searches or public page reads through a portable text
     protocol. The resulting evidence is marked untrusted before it returns to
     the model.
4. **Streaming back** — the runner `emit`s events the UI consumes:
   `phase`, `text` (token deltas), `activity` (tool/RAG use), `draft`, `notice`,
   `done`, `error`.

## Engines

The engine is chosen globally or per tab.

- **Claude Code** (`@anthropic-ai/claude-agent-sdk`) — the default. Reuses your
  existing Claude Code auth. By default the agent reads the vault itself with
  `Read`/`Grep`/`Glob`. User-selected `SKILL.md` files are embedded in the
  request for this engine and for every CLI engine.
- **Gemini Antigravity** (`agent/gemini.ts`) — shells out to the `agy` CLI in a
  sandboxed temp dir. It gets no filesystem access; the app gathers vault context
  and injects it into the prompt. Humanization uses inline rules, and follow-ups
  pass the prior answer in the prompt.

## How context reaches the model

There are two ways the model sees the vault, switched by the **RAG** toggle:

| Mode | Claude Code | Gemini |
| --- | --- | --- |
| RAG **off** | Agent reads vault files on demand (`Read`/`Grep`/`Glob`). | Whole vault is gathered (up to ~150 KB) and injected. |
| RAG **on** | Relevant excerpts are retrieved and injected; file tools are disabled. | Only the retrieved excerpts are injected. |

RAG mode is the token-efficient path. See [rag.md](rag.md) for details.

## Where things live

- Prompt text and persona — `agent/config.ts`
- Retrieval — `agent/rag.ts`
- Session persistence — `agent/runner.ts` (`.sessions.json`)
- Activity log persistence — `agent/logs.ts` (`logs/activity.jsonl`)
- Claude Code usage (`/usage` data) — `agent/usage.ts`
- Client state and localStorage — `src/lib/store.ts`
- API client (SSE parsing) — `src/lib/api.ts`
- Local web search and content resolution — `agent/web.ts`; see
  [web-research.md](web-research.md)
