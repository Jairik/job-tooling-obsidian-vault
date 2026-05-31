import { useState } from "react";
import type { Phase } from "../lib/store";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "",
  draft: "Drafting…",
  humanize: "Humanizing…",
  followup: "Revising…",
  done: "Ready",
  error: "Error",
};

interface Props {
  phase: Phase;
  draft: string;
  answer: string;
  notice?: string;
  error?: string;
}

export function AnswerStream({ phase, draft, answer, notice, error }: Props) {
  const [showDraft, setShowDraft] = useState(false);
  const [copied, setCopied] = useState(false);
  const running = phase === "draft" || phase === "humanize" || phase === "followup";
  // While drafting (before humanize), show the draft text live in the main panel.
  const display = phase === "draft" ? draft : answer || draft;

  const copy = async () => {
    await navigator.clipboard.writeText(answer || draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="answer">
      <div className="answer-head">
        <span className={`phase-badge phase-${phase}`}>
          {running && <span className="spinner" />}
          {PHASE_LABEL[phase]}
        </span>
        {(answer || draft) && (
          <button className="copy-btn" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      {notice && <div className="notice">{notice}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="answer-text">
        {display ? (
          <>
            {display}
            {running && <span className="caret" />}
          </>
        ) : (
          !error && <span className="placeholder">The grounded, humanized answer will appear here.</span>
        )}
      </div>

      {phase !== "draft" && draft && answer && (
        <div className="draft-box">
          <button className="draft-toggle" onClick={() => setShowDraft((s) => !s)}>
            {showDraft ? "▾" : "▸"} Original draft (pre-humanize)
          </button>
          {showDraft && <div className="draft-text">{draft}</div>}
        </div>
      )}
    </div>
  );
}
