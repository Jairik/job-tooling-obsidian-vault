import { useState } from "react";
import type { Activity } from "../lib/store";

const TOOL_VERB: Record<string, string> = {
  Read: "Reading",
  Grep: "Searching",
  Glob: "Finding",
  Skill: "Running skill",
  agy: "Gemini",
  RAG: "Retrieved",
};

export function ActivityLog({ activity }: { activity: Activity[] }) {
  const [open, setOpen] = useState(false);
  if (!activity.length) return null;

  return (
    <div className="activity">
      <button className="activity-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Context activity ({activity.length})
      </button>
      {open && (
        <ul className="activity-list">
          {activity.map((a, i) => (
            <li key={i}>
              <span className="activity-verb">{TOOL_VERB[a.tool] ?? a.tool}</span>
              {a.input && <span className="activity-input"> {a.input}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
