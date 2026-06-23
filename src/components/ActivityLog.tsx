// A collapsible list of the tools the agent used while producing an answer — file
// reads, searches, skill runs, RAG retrievals — so the user can see how the answer
// was grounded. Hidden entirely when there was no activity.
import { useState } from "react";
import type { Activity } from "../lib/store";

// Friendly verb/label shown for each tool or CLI engine in the activity list.
const TOOL_VERB: Record<string, string> = {
  Read: "Reading",
  Grep: "Searching",
  Glob: "Finding",
  Skill: "Running skill",
  agy: "Gemini",
  gemini: "Gemini",
  opencode: "OpenCode",
  cursor: "Cursor Agent",
  copilot: "GitHub Copilot",
  codex: "Codex",
  RAG: "Retrieved",
};

/* Displays compact tool activity emitted while a model turn is in progress. */
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
