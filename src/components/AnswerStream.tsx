// Renders a tab's answer: a phase status pill, the live streaming text (which
// becomes an editable textarea once the run finishes), copy / regenerate / clean-up
// actions, and — in job mode — a collapsible view of the original pre-humanize draft.
import { useState } from "react";
import type { Phase, TabMode } from "../lib/store";

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

export function AnswerStream({ phase, mode, draft, answer, notice, error, onEditAnswer, onCleanup, onRegenerate }: Props) {
  const [showDraft, setShowDraft] = useState(false);
  const [copied, setCopied] = useState(false);
  const running = phase === "draft" || phase === "humanize" || phase === "cleanup" || phase === "followup";
  // While drafting (before humanize), show the draft text live in the main panel.
  const display = phase === "draft" ? draft : answer || draft;
  const hasContent = Boolean(answer || draft);

  const copy = async () => {
    await navigator.clipboard.writeText(answer || draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  // Map the current phase onto a status pill tone.
  const pillClass =
    phase === "done" ? "pill pill--success" : phase === "error" ? "pill pill--danger" : "pill";
  const dotClass = phase === "done" ? "dot ok" : phase === "error" ? "dot bad" : "dot";

  return (
    <div className="card answer">
      <div className="card-h answer-head">
        <span className={pillClass}>
          {running ? (
            <span className="phase-spin">
              <span className="spinner" />
              {PHASE_LABEL[phase]}
            </span>
          ) : (
            <>
              <span className={dotClass} />
              {PHASE_LABEL[phase] || "ready"}
            </>
          )}
        </span>
        <div className="answer-actions">
          <button
            className="act-btn"
            title="Regenerate"
            aria-label="Regenerate"
            disabled={running}
            onClick={onRegenerate}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 4v5h-5" />
            </svg>
          </button>
          <button
            className="act-btn"
            title="Clean up — fix grammar and humanize the writing"
            aria-label="Clean up"
            disabled={running || !hasContent}
            onClick={onCleanup}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
              <path d="M19 14l.7 1.9 1.8.6-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.6z" />
            </svg>
          </button>
          {hasContent && (
            <button className="copy-btn" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </div>

      <div className="card-b">
        {notice && <div className="notice">{notice}</div>}
        {error && <div className="error-box">{error}</div>}

        {running ? (
          <div className="answer-text">
            {display ? (
              <>
                {display}
                <span className="caret" />
              </>
            ) : (
              !error && <span className="placeholder">The grounded answer will appear here.</span>
            )}
          </div>
        ) : hasContent ? (
          <textarea
            className="answer-edit"
            value={answer}
            spellCheck
            placeholder="The grounded answer will appear here."
            onChange={(e) => onEditAnswer(e.target.value)}
          />
        ) : (
          !error && (
            <div className="answer-text">
              <span className="placeholder">The grounded answer will appear here.</span>
            </div>
          )
        )}

        {mode === "job" && phase !== "draft" && draft && answer && (
          <div className="draft-box">
            <button className="draft-toggle" onClick={() => setShowDraft((s) => !s)}>
              {showDraft ? "▾" : "▸"} Original draft (pre-humanize)
            </button>
            {showDraft && <div className="draft-text">{draft}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
