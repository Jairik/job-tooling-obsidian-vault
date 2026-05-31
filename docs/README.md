# Job Answer Studio — Documentation

High-level docs for what this project is and how it works. For setup and the
quickstart, see the top-level [`../README.md`](../README.md).

## What it is

A small local web app that drafts job-application answers in JJ's voice. You
paste a job description and a specific application question into a tab, hit
**Generate**, and it writes a first-person answer grounded in your Obsidian
vault, then humanizes it. Each tab is an independent conversation you can refine
with follow-up messages.

Everything runs locally on [Bun](https://bun.sh): one process serves the React
UI and a small JSON + SSE API, and drives the model.

## The pieces

| Area | File(s) | Role |
| --- | --- | --- |
| Server | `server.ts` | Bun server: serves the UI, exposes the API, streams results over SSE. |
| Agent pipeline | `agent/runner.ts` | Draft turn → humanize turn; manages one session per tab. |
| Config & prompts | `agent/config.ts` | Defaults, model list, persona, and prompt builders. |
| Retrieval (RAG) | `agent/rag.ts` | Pure-Bun BM25 retrieval over the vault. See [rag.md](rag.md). |
| Engines | `agent/gemini.ts` | Optional `agy` (Gemini Antigravity) engine. |
| Skills | `agent/skills.ts` | Detects the `humanizer` / `yc-combinator` skills. |
| UI | `src/` | React app: tabs, settings, activity log, answer stream. |

## Docs in this folder

- [architecture.md](architecture.md) — how a request flows from the UI to an answer.
- [rag.md](rag.md) — the RAG retrieval feature and the **RAG** toggle.

## Key ideas

- **Grounded, never fabricated.** Answers are built only from what the vault
  actually says. If the vault doesn't support a claim, it's left out.
- **Two engines.** Claude Code (default) or Gemini Antigravity (`agy` CLI).
- **RAG to save tokens.** Toggle **RAG** on a tab to send only the most relevant
  vault excerpts instead of reading or dumping the whole vault.
- **Local and private.** Your vault never leaves your machine; the app reuses
  your existing Claude Code login.
