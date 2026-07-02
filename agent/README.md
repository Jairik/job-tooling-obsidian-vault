# Backend Agent System (`/agent`)

This directory contains the core backend logic for Vault Assistant, including LLM CLI orchestration, RAG indexing, search tools, and document management. It is designed to run in the Bun environment.

## Key Subsystems

- **`runner.ts`**: The main execution pipeline. Orchestrates the workflow steps (e.g. prompt drafting followed by humanization) for both Claude Code SDK and the terminal CLI engines, emitting events back to the client.
- **`gemini.ts`**: Handles the execution of local command-line interface engines (`agy`/Gemini, `opencode`, `cursor`, `copilot`, `codex`) inside temporary sandbox directories.
- **`rag.ts`**: Implements a dependency-free, heading-aware local BM25 search index over the user's Markdown vault to minimize context token usage.
- **`skills.ts`**: Manages portable, Claude-compatible `.md` instructions (discovered in user home or local vault directories) and injects them dynamically into the prompt.
- **`config.ts`**: Builds and formats prompts, handles server settings, system prompts, and default options.
- **`attachments.ts`**: Handles parsing of file attachments (PDFs using `unpdf`, Word files using `mammoth`, etc.) into markdown text.
- **`documents.ts`**: Handles logic for proposed file edits and writes within the user's vault.
- **`latex.ts`**: Implements a local LaTeX rendering pipeline (using `tectonic` if available) to provide dynamic PDF previews.
- **`logs.ts`**: Manages log persistence and live event stream monitoring.
- **`usage.ts`**: Fetches current API quota limits and usage statistics for Claude Code, Codex, and OpenCode CLI.
- **`web.ts`**: Operates web search and article retrieval tasks via a local SearXNG instance.

## Testing

Testing is implemented in [`agent.test.ts`](file:///home/jj/repos/vault-assistant/agent/agent.test.ts). Refer to [`docs/WORKFLOW.md`](file:///home/jj/repos/vault-assistant/docs/WORKFLOW.md) for guidelines on writing tests for new backend changes.
