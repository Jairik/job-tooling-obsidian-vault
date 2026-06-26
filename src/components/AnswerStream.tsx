// Renders a tab's answer: a phase status pill, the live streaming text (which
// becomes an editable textarea once the run finishes), copy / regenerate / clean-up
// actions, and — in job mode — a collapsible view of the original pre-humanize draft.
import { useEffect, useRef, useState } from "react";
import type { Phase, TabMode } from "../lib/store";
import { Markdown } from "./Markdown";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "",
  draft: "Answering…",
  humanize: "Humanizing…",
  cleanup: "Cleaning up…",
  followup: "Revising…",
  done: "Ready",
  error: "Error",
};

interface Props {
  phase: Phase;
  mode: TabMode;
  draft: string;
  answer: string;
  notice?: string;
  error?: string;
  onEditAnswer: (text: string) => void;
  onCleanup: () => void;
  onRegenerate: () => void;
}

/* Shows streamed model text, editable final output, errors, and answer actions. */
export function AnswerStream({ phase, mode, draft, answer, notice, error, onEditAnswer, onCleanup, onRegenerate }: Props) {
  const [showDraft, setShowDraft] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  // Points at the rendered-markdown container; its `innerText` is the visible
  // text with markers stripped, used for both copy and entering edit mode.
  const previewRef = useRef<HTMLDivElement>(null);
  const running = phase === "draft" || phase === "humanize" || phase === "cleanup" || phase === "followup";
  // Leave the editor whenever a new run starts so the regenerated answer renders
  // formatted (and isn't shown as raw markdown in the textarea).
  useEffect(() => {
    if (running) setEditing(false);
  }, [running]);
  // While drafting (before humanize), show the draft text live in the main panel.
  const display = phase === "draft" ? draft : answer || draft;
  const hasContent = Boolean(answer || draft);

  /* The visible, markdown-stripped text — what the user actually sees. */
  const plainText = () => previewRef.current?.innerText ?? (answer || draft);

  /* Copies the answer as plain characters (no markdown syntax). */
  const copy = async () => {
    await navigator.clipboard.writeText(editing ? answer : plainText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  /* Switches to the editor, first flattening the answer to plain text so no
     markdown markers survive into (or persist after) editing. */
  const enterEdit = () => {
    onEditAnswer(plainText());
    setEditing(true);
  };

  // Map the current phase onto the status-pill tone (hidden while idle).
  const pillTone = running ? "running" : phase === "done" ? "done" : phase === "error" ? "error" : "hidden";

  return (
    <div className="answer-card">
      <div className="answer-head">
        <span className="answer-label">Answer</span>
        <span className={`phase-pill ${pillTone}`}>
          <span className="phase-dot" />
          {PHASE_LABEL[phase] || "Ready"}
        </span>
        <span className="gap-auto" />
        <button
          className="ans-action-btn"
          title="Regenerate"
          aria-label="Regenerate"
          disabled={running}
          onClick={onRegenerate}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 4v5h-5" />
          </svg>
        </button>
        <button
          className="ans-action-btn"
          title="Clean up — fix grammar and humanize the writing"
          aria-label="Clean up"
          disabled={running || !hasContent}
          onClick={onCleanup}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
            <path d="M19 14l.7 1.9 1.8.6-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.6z" />
          </svg>
        </button>
        {hasContent && !running && (
          <button
            className={`ans-action-btn ${editing ? "active" : ""}`}
            title={editing ? "Done editing" : "Edit as plain text"}
            aria-label={editing ? "Done editing" : "Edit"}
            onClick={() => (editing ? setEditing(false) : enterEdit())}
          >
            {editing ? (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            )}
          </button>
        )}
        {hasContent && (
          <button className={`copy-btn ${copied ? "copied" : ""}`} onClick={copy}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      <div className="answer-body">
        {notice && <div className="notice">{notice}</div>}
        {error && <div className="error-box">{error}</div>}

        {running ? (
          display ? (
            <div className="answer-text">
              <Markdown ref={previewRef}>{display}</Markdown>
              <span className="caret" />
            </div>
          ) : (
            !error && (
              <div className="answer-placeholder">
                <span className="placeholder">The grounded answer will appear here.</span>
              </div>
            )
          )
        ) : hasContent ? (
          editing ? (
            <textarea
              className="answer-edit-area"
              value={answer}
              spellCheck
              autoFocus
              placeholder="The grounded answer will appear here."
              onChange={(e) => onEditAnswer(e.target.value)}
            />
          ) : (
            <div className="answer-text">
              <Markdown ref={previewRef}>{answer}</Markdown>
            </div>
          )
        ) : (
          !error && (
            <div className="answer-placeholder">
              <svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="24" cy="24" r="20" />
                <path d="M19 18.8a5.5 5.5 0 0 1 10 2.8c0 3.6-5 4.4-5 7.4" />
                <path d="M24 37.5h.01" />
              </svg>
              <p>Write a question above and hit Generate. The vault will answer in your voice.</p>
            </div>
          )
        )}

        {mode === "job" && phase !== "draft" && draft && answer && (
          <div className="draft-box">
            <button className="draft-toggle" onClick={() => setShowDraft((s) => !s)}>
              {showDraft ? "▾" : "▸"} Original draft (pre-humanize)
            </button>
            {showDraft && <Markdown className="draft-text">{draft}</Markdown>}
          </div>
        )}
      </div>
    </div>
  );
}
