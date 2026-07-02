// The mandatory approval step for every vault write. Shows exactly what will
// land on disk — target path, new-file vs modify badge, and a line diff against
// the current file content — and only the Approve button consumes the one-time
// write token minted by /api/vault/preview. Nothing is written on Reject.
import { useEffect, useMemo } from "react";
import { diffLines } from "diff";

interface Props {
  path: string;
  exists: boolean;
  // Existing file content ("" for new files, or when too large to diff).
  existingContent: string;
  tooLarge?: boolean;
  newContent: string;
  busy: boolean;
  error?: string;
  onApprove: () => void;
  onReject: () => void;
}

interface DiffRow {
  kind: "add" | "del" | "ctx" | "skip";
  text: string;
}

const COLLAPSE_THRESHOLD = 8;
const COLLAPSE_KEEP = 3;

/* Flattens diffLines output into renderable rows, collapsing long unchanged runs. */
function buildRows(existing: string, next: string): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const part of diffLines(existing, next)) {
    const kind: DiffRow["kind"] = part.added ? "add" : part.removed ? "del" : "ctx";
    const lines = part.value.replace(/\n$/, "").split("\n");
    if (kind === "ctx" && lines.length > COLLAPSE_THRESHOLD) {
      for (const line of lines.slice(0, COLLAPSE_KEEP)) rows.push({ kind, text: line });
      rows.push({ kind: "skip", text: `⋯ ${lines.length - COLLAPSE_KEEP * 2} unchanged lines` });
      for (const line of lines.slice(-COLLAPSE_KEEP)) rows.push({ kind, text: line });
    } else {
      for (const line of lines) rows.push({ kind, text: line });
    }
  }
  return rows;
}

/* Asks the user to approve one vault write, with a diff of the change. */
export function ApprovalModal({ path, exists, existingContent, tooLarge, newContent, busy, error, onApprove, onReject }: Props) {
  const rows = useMemo(
    () => (exists && !tooLarge ? buildRows(existingContent, newContent) : null),
    [exists, tooLarge, existingContent, newContent]
  );

  // Escape rejects, matching how the other dialogs close without action.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onReject();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onReject]);

  return (
    <div className="modal-wrap" onClick={onReject}>
      <div className="approval-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="approval-head">
          <span className="approval-title">Write to vault</span>
          <span className={`approval-badge ${exists ? "modify" : "new"}`}>
            {exists ? "Modifies existing file" : "New file"}
          </span>
          <span className="gap-auto" />
          <code className="approval-path">{path}</code>
        </div>

        <div className="approval-body">
          {error && <div className="error-box">{error}</div>}
          {tooLarge && <div className="notice small">The existing file is too large to diff — the content below fully replaces it.</div>}
          {rows ? (
            <pre className="diff-view">
              {rows.map((row, i) => (
                <div key={i} className={`diff-line ${row.kind}`}>
                  <span className="diff-marker">{row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}</span>
                  {row.text}
                </div>
              ))}
            </pre>
          ) : (
            <pre className="diff-view">
              {newContent.split("\n").map((line, i) => (
                <div key={i} className={`diff-line ${exists ? "add" : "ctx"}`}>
                  <span className="diff-marker">{exists ? "+" : " "}</span>
                  {line}
                </div>
              ))}
            </pre>
          )}
        </div>

        <div className="approval-foot">
          <button className="btn btn-ghost" onClick={onReject} disabled={busy}>
            Reject
          </button>
          <button className="btn btn-primary" onClick={onApprove} disabled={busy}>
            {busy ? "Writing…" : "Approve & write"}
          </button>
        </div>
      </div>
    </div>
  );
}
