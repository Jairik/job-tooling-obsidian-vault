import { useState, type CSSProperties } from "react";
import type { Tab } from "../lib/store";

interface Props {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

const PHASE_DOT: Record<string, string> = {
  draft: "dot-running",
  humanize: "dot-running",
  followup: "dot-running",
  done: "dot-done",
  error: "dot-error",
};

export function TabBar({ tabs, activeId, onSelect, onAdd, onClose, onRename }: Props) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="tabbar">
      {tabs.map((t) => {
        const active = t.id === activeId;
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
    </div>
  );
}
