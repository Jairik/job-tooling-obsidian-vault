// The row of conversation tabs. Each tab shows a status dot (idle / running / done
// / error), a mode glyph (Ask vs Job), an inline-rename input (double-click the
// name), and a close button. The active tab is tinted with its own accent color.
import { useState, type CSSProperties } from "react";
import type { Tab } from "../lib/store";

interface Props {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
  onClearAll: () => void;
  onRename: (id: string, name: string) => void;
}

/* Phase → status-dot CSS class. Unlisted phases use the tab's accent color. */
const PHASE_DOT: Record<string, string> = {
  draft: "dot-running",
  humanize: "dot-running",
  followup: "dot-running",
  done: "dot-done",
  error: "dot-error",
};

export function TabBar({ tabs, activeId, onSelect, onAdd, onClose, onClearAll, onRename }: Props) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="tabbar">
      {tabs.map((t) => {
        const active = t.id === activeId;
        // Every tab carries a colored left edge; the active tab gets its accent
        // tint extended to all borders + a faint background so it stands out.
        const style: CSSProperties = {
          borderLeftWidth: 3,
          borderLeftStyle: "solid",
          borderLeftColor: t.color,
        };
        if (active) {
          style.borderTopColor = t.color;
          style.borderRightColor = t.color;
          style.borderBottomColor = t.color;
          style.background = `${t.color}22`;
        }
        const statusClass = PHASE_DOT[t.phase];
        return (
        <div
          key={t.id}
          className={`tab ${active ? "active" : ""}`}
          style={style}
          onClick={() => onSelect(t.id)}
        >
          <span
            className={`dot ${statusClass ?? ""}`}
            style={statusClass ? undefined : { background: t.color }}
          />
          <span className="tab-mode" title={t.mode === "job" ? "Job mode" : "Ask mode"} aria-hidden>
            {t.mode === "job" ? (
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="7" width="18" height="13" rx="2" />
                <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M9.6 9.2a2.5 2.5 0 0 1 4.6 1.3c0 1.6-2.2 1.9-2.2 3.3" />
                <path d="M12 17.2h.01" />
              </svg>
            )}
          </span>
          {editing === t.id ? (
            <input
              className="tab-rename"
              autoFocus
              defaultValue={t.name}
              onBlur={(e) => {
                onRename(t.id, e.target.value.trim() || t.name);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditing(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="tab-name" onDoubleClick={() => setEditing(t.id)}>
              {t.name}
            </span>
          )}
          {tabs.length > 1 && (
            <button
              className="tab-close"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
            >
              ×
            </button>
          )}
        </div>
        );
      })}
      <button className="tab-add" title="New tab" onClick={onAdd}>
        +
      </button>
      {tabs.length > 1 && (
        <button className="tab-clear" title="Close all tabs" onClick={onClearAll}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        </button>
      )}
    </div>
  );
}
