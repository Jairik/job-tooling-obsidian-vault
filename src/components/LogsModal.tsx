import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { PALETTE, type LogEntry, type LogKind } from "../lib/store";

interface Props {
  logs: LogEntry[];
  onClear: () => void;
  onClose: () => void;
}

const KIND_LABEL: Record<LogKind, string> = {
  generate: "generate",
  followup: "follow-up",
  answer: "answer",
  error: "error",
  tool: "tool",
};

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDuration(ms?: number): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function LogsModal({ logs, onClear, onClose }: Props) {
  const dark = (document.documentElement.dataset.theme ?? "dark") !== "light";
  const axisColor = dark ? "#8a93a6" : "#6b7280";
  const gridColor = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
  const accent = PALETTE[0];

  const stats = useMemo(() => {
    const answers = logs.filter((l) => l.kind === "answer");
    const durations = answers.map((a) => a.durationMs).filter((d): d is number => typeof d === "number");
    const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    return {
      events: logs.length,
      answers: answers.length,
      errors: logs.filter((l) => l.kind === "error").length,
      tools: logs.filter((l) => l.kind === "tool").length,
      avgMs: avg,
    };
  }, [logs]);

  // Tool usage: parse the tool name from the "Tool · input" detail.
  const toolData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of logs) {
      if (l.kind !== "tool") continue;
      const name = (l.detail ?? "").split(" · ")[0].trim() || "tool";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [logs]);

  // Events bucketed by hour (last 24 buckets that have activity).
  const timeData = useMemo(() => {
    const counts = new Map<number, number>();
    for (const l of logs) {
      const hour = Math.floor(l.ts / 3_600_000) * 3_600_000;
      counts.set(hour, (counts.get(hour) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(-24)
      .map(([hour, count]) => ({
        label: new Date(hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        count,
      }));
  }, [logs]);

  // Engine mix across the runs that were initiated (generate + follow-up).
  const engineData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of logs) {
      if (l.kind !== "generate" && l.kind !== "followup") continue;
      const name = l.engine ?? "unknown";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, value]) => ({ name, value }));
  }, [logs]);

  // Q&A produced (newest first) — the answers the tool has generated.
  const answers = useMemo(() => logs.filter((l) => l.kind === "answer").slice().reverse(), [logs]);

  // Full activity feed, newest first.
  const feed = useMemo(() => logs.slice().reverse(), [logs]);

  const empty = logs.length === 0;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer logs" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>Logs</h2>
          <button className="icon-btn" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="drawer-sub">Recent activity, generated answers, and stats — stored locally on this device.</p>

        {empty ? (
          <div className="log-empty">No activity yet. Generate an answer and it'll show up here.</div>
        ) : (
          <>
            <section className="log-stats">
              <div className="stat-card">
                <span className="stat-num">{stats.events}</span>
                <span className="stat-label">events</span>
              </div>
              <div className="stat-card">
                <span className="stat-num">{stats.answers}</span>
                <span className="stat-label">answers</span>
              </div>
              <div className="stat-card">
                <span className="stat-num">{stats.tools}</span>
                <span className="stat-label">tool calls</span>
              </div>
              <div className={`stat-card ${stats.errors ? "bad" : ""}`}>
                <span className="stat-num">{stats.errors}</span>
                <span className="stat-label">errors</span>
              </div>
              <div className="stat-card">
                <span className="stat-num">{stats.avgMs ? fmtDuration(Math.round(stats.avgMs)) : "—"}</span>
                <span className="stat-label">avg answer</span>
              </div>
            </section>

            <section className="log-charts">
              {toolData.length > 0 && (
                <div className="log-chart">
                  <span className="log-chart-title">Tools used</span>
                  <ResponsiveContainer width="100%" height={Math.max(120, toolData.length * 28)}>
                    <BarChart data={toolData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke={gridColor} />
                      <XAxis type="number" allowDecimals={false} tick={{ fill: axisColor, fontSize: 11 }} stroke={gridColor} />
                      <YAxis type="category" dataKey="name" width={70} tick={{ fill: axisColor, fontSize: 11 }} stroke={gridColor} />
                      <Tooltip cursor={{ fill: "transparent" }} contentStyle={{ fontSize: 12 }} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {toolData.map((_, i) => (
                          <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {timeData.length > 0 && (
                <div className="log-chart">
                  <span className="log-chart-title">Events over time</span>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={timeData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                      <CartesianGrid vertical={false} stroke={gridColor} />
                      <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 10 }} stroke={gridColor} />
                      <YAxis allowDecimals={false} width={28} tick={{ fill: axisColor, fontSize: 11 }} stroke={gridColor} />
                      <Tooltip cursor={{ fill: "transparent" }} contentStyle={{ fontSize: 12 }} />
                      <Bar dataKey="count" fill={accent} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {engineData.length > 0 && (
                <div className="log-chart">
                  <span className="log-chart-title">Engine mix</span>
                  <ResponsiveContainer width="100%" height={170}>
                    <PieChart>
                      <Pie data={engineData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label>
                        {engineData.map((_, i) => (
                          <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                        ))}
                      </Pie>
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {answers.length > 0 && (
              <section className="log-qa">
                <span className="log-section-title">Answers</span>
                {answers.map((a) => (
                  <div className="log-qa-item" key={a.id}>
                    <div className="log-qa-head">
                      <span className="dot" style={{ background: a.tabColor }} />
                      <span className="log-qa-tab">{a.tabName}</span>
                      <span className="log-qa-meta">
                        {fmtDuration(a.durationMs)}
                        {a.chars != null ? ` · ${a.chars} chars` : ""} · {fmtTime(a.ts)}
                      </span>
                    </div>
                    {a.question && <div className="log-qa-q">{a.question}</div>}
                    {a.detail && <div className="log-qa-a">{a.detail}…</div>}
                  </div>
                ))}
              </section>
            )}

            <section className="log-feed">
              <span className="log-section-title">Activity</span>
              {feed.map((l) => (
                <div className={`log-row ${l.kind === "error" ? "bad" : ""}`} key={l.id}>
                  <span className="log-time">{fmtTime(l.ts)}</span>
                  <span className="dot" style={{ background: l.tabColor }} />
                  <span className="log-tab">{l.tabName}</span>
                  <span className={`log-badge log-badge--${l.kind}`}>{KIND_LABEL[l.kind]}</span>
                  <span className="log-detail">
                    {l.question ? l.question : l.detail}
                    {l.kind === "answer" && l.durationMs != null && (
                      <span className="log-dim"> · {fmtDuration(l.durationMs)}</span>
                    )}
                  </span>
                </div>
              ))}
            </section>

            <div className="log-footer">
              <button className="btn btn-ghost" onClick={onClear}>
                Clear logs
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
