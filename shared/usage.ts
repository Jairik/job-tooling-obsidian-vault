/* The `/api/usage` response contract, shared to prevent server/client drift. */
import type { Engine } from "./settings";

export type UsageProvider = "claude-code" | "codex" | "opencode";

export interface UsageTarget {
  engine: Engine;
  model: string;
}

export interface UsageSupport {
  supported: boolean;
  provider?: UsageProvider;
  providerLabel?: string;
  reason?: string;
}

export interface UsageWindow {
  utilization: number;
  resetsAt: string | null;
}

export interface UsageLimitWindow extends UsageWindow {
  label: string;
  detail?: string;
}

export interface UsageStat {
  label: string;
  value: string;
}

export interface UsageResult {
  ok: boolean;
  unsupported?: boolean;
  error?: string;
  provider?: UsageProvider;
  providerLabel?: string;
  target?: UsageTarget;
  windows?: UsageLimitWindow[];
  stats?: UsageStat[];
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  sevenDayOpus?: UsageWindow;
  extraUsage?: { enabled: boolean; utilization: number | null };
}

/* True for model ids the Claude Code subscription usage endpoint can describe. */
export function isClaudeUsageModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return !normalized || normalized === "auto" || normalized.startsWith("claude-");
}

/*
 * Maps the selected engine/model to a usage provider. Keep this pure and shared
 * so unsupported targets are handled consistently in the Settings UI and API.
 */
export function usageSupportForTarget(target: UsageTarget): UsageSupport {
  if (target.engine === "claude" && isClaudeUsageModel(target.model)) {
    return { supported: true, provider: "claude-code", providerLabel: "Claude Code" };
  }

  if (target.engine === "codex") {
    return { supported: true, provider: "codex", providerLabel: "Codex" };
  }

  if (target.engine === "opencode") {
    return { supported: true, provider: "opencode", providerLabel: "OpenCode" };
  }

  return {
    supported: false,
    reason: "Usage checking is not available for the selected engine and model.",
  };
}
