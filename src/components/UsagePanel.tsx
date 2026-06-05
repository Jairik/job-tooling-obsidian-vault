// Settings widget that shows the current Claude Code subscription usage — the
// same rolling 5-hour and 7-day limits the CLI's `/usage` command reports. It
// fetches on demand (button click) from /api/usage, which reads Claude Code's
// local OAuth token. Only rendered for the Claude engine.
import { useState } from "react";
import { api, type UsageResult, type UsageWindow } from "../lib/api";

// "resets in 3h 12m" / "resets in 2d 4h" from an ISO timestamp.
function fmtReset(resetsAt: string | null): string {
  if (!resetsAt) return "";
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "resets shortly";
  const mins = Math.round(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const parts = d > 0 ? [`${d}d`, `${h}h`] : h > 0 ? [`${h}h`, `${m}m`] : [`${m}m`];
  return `resets in ${parts.join(" ")}`;
}

function UsageBar({ label, win }: { label: string; win: UsageWindow }) {
  const pct = Math.max(0, Math.min(100, win.utilization));
  const tone = pct >= 90 ? "bad" : pct >= 75 ? "warn" : "ok";
  return (
    <div className="usage-row">
      <div className="usage-row-head">
        <span className="usage-row-label">{label}</span>
        <span className="usage-row-pct">{Math.round(pct)}%</span>
      </div>
      <div className="usage-track">
        <div className={`usage-fill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {win.resetsAt && <span className="usage-row-reset">{fmtReset(win.resetsAt)}</span>}
    </div>
  );
}

export function UsagePanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UsageResult | null>(null);

  const check = async () => {
    setLoading(true);
    try {
      setResult(await api.usage());
    } catch (e: any) {
      setResult({ ok: false, error: e?.message ? String(e.message) : "Failed to fetch usage." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="usage-panel">
      <button className="btn btn-ghost" onClick={check} disabled={loading}>
        {loading ? "Checking…" : result ? "Refresh usage" : "Check usage"}
      </button>

      {result && !result.ok && <div className="vault-status bad usage-error">{result.error}</div>}

      {result?.ok && (
        <div className="usage-results">
          {result.fiveHour && <UsageBar label="Current session (5h)" win={result.fiveHour} />}
          {result.sevenDay && <UsageBar label="This week (7d)" win={result.sevenDay} />}
          {result.sevenDayOpus && <UsageBar label="Opus this week (7d)" win={result.sevenDayOpus} />}
          {result.extraUsage?.enabled && result.extraUsage.utilization != null && (
            <UsageBar label="Extra usage" win={{ utilization: result.extraUsage.utilization, resetsAt: null }} />
          )}
          {!result.fiveHour && !result.sevenDay && (
            <div className="notice small">No usage limits reported for this account.</div>
          )}
        </div>
      )}
    </div>
  );
}
