// Settings widget that shows provider usage for the selected engine/model when
// the app has a compatible local usage provider.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  usageSupportForTarget,
  type UsageLimitWindow,
  type UsageResult,
  type UsageStat,
} from "../../shared/usage";
import type { Engine } from "../../shared/settings";

interface Props {
  engine: Engine;
  model: string;
}

// "resets in 3h 12m" / "resets in 2d 4h" from an ISO timestamp.
/* Turns the API's reset timestamp into a short, user-friendly local time. */
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

function resultWindows(result: UsageResult): UsageLimitWindow[] {
  const windows = [...(result.windows ?? [])];
  if (result.fiveHour) windows.push({ label: "Current session (5h)", ...result.fiveHour });
  if (result.sevenDay) windows.push({ label: "This week (7d)", ...result.sevenDay });
  if (result.sevenDayOpus) windows.push({ label: "Opus this week (7d)", ...result.sevenDayOpus });
  if (result.extraUsage?.enabled && result.extraUsage.utilization != null) {
    windows.push({
      label: "Extra usage",
      utilization: result.extraUsage.utilization,
      resetsAt: null,
    });
  }
  return windows;
}

/* Renders one bounded quota bar, including its next reset time. */
function UsageBar({ win }: { win: UsageLimitWindow }) {
  const pct = Math.max(0, Math.min(100, win.utilization));
  const tone = pct >= 90 ? "bad" : pct >= 75 ? "warn" : "ok";
  const reset = fmtReset(win.resetsAt);
  return (
    <div className="usage-row">
      <div className="usage-row-head">
        <span className="usage-row-label">{win.label}</span>
        <span className="usage-row-pct">{Math.round(pct)}%</span>
      </div>
      <div className="usage-track">
        <div className={`usage-fill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {(reset || win.detail) && <span className="usage-row-reset">{[reset, win.detail].filter(Boolean).join(" · ")}</span>}
    </div>
  );
}

function UsageStats({ stats }: { stats: UsageStat[] }) {
  return (
    <div className="usage-stat-list">
      {stats.map((stat) => (
        <div className="usage-stat" key={`${stat.label}:${stat.value}`}>
          <span className="usage-stat-label">{stat.label}</span>
          <span className="usage-stat-value">{stat.value}</span>
        </div>
      ))}
    </div>
  );
}

/* Fetches and presents provider quota without exposing credentials. */
export function UsagePanel({ engine, model }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UsageResult | null>(null);
  const target = { engine, model };
  const support = usageSupportForTarget(target);
  const windows = result?.ok ? resultWindows(result) : [];
  const stats = result?.ok ? result.stats ?? [] : [];

  useEffect(() => {
    setResult(null);
  }, [engine, model]);

  /* Refreshes quota data and retains a readable error if the local login is unavailable. */
  const check = async () => {
    if (!support.supported) return;
    setLoading(true);
    try {
      setResult(await api.usage(target));
    } catch (e: any) {
      setResult({ ok: false, error: e?.message ? String(e.message) : "Failed to fetch usage." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="usage-panel">
      {!support.supported && (
        <div className="notice small usage-unsupported">{support.reason}</div>
      )}

      {support.supported && (
        <>
          <button className="btn btn-ghost" onClick={check} disabled={loading}>
            {loading ? "Checking…" : result ? "Refresh usage" : "Check usage"}
          </button>

          {(result?.providerLabel ?? support.providerLabel) && (
            <div className="usage-provider">{result?.providerLabel ?? support.providerLabel}</div>
          )}

          {result && !result.ok && <div className="vault-status bad usage-error">{result.error}</div>}

          {result?.ok && (
            <div className="usage-results">
              {windows.map((win) => <UsageBar key={`${win.label}:${win.resetsAt ?? ""}`} win={win} />)}
              {stats.length > 0 && <UsageStats stats={stats} />}
              {windows.length === 0 && stats.length === 0 && <div className="notice small">No usage reported for this account.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
