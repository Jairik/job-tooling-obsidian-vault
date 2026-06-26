// Reports usage for any engine/model pair with a compatible local usage provider.
// Claude and Codex use their local first-party auth files; OpenCode reports from
// its local stats command.
import { Buffer } from "buffer";
import { homedir } from "os";
import { join } from "path";
import {
  usageSupportForTarget,
  type UsageLimitWindow,
  type UsageResult,
  type UsageStat,
  type UsageTarget,
  type UsageWindow,
} from "../shared/usage";

const CLAUDE_CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
// Beta header Claude Code sends on its OAuth API calls.
const OAUTH_BETA = "oauth-2025-04-20";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_PROFILE_URL = "https://chatgpt.com/backend-api/wham/profiles/me";
const CODEX_REFRESH_URL = "https://auth.openai.com/oauth/token";
const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

interface OAuthCreds {
  accessToken: string;
  expiresAt?: number;
}

interface CodexAuth {
  token: string;
  accountId?: string;
  fedramp?: boolean;
  refreshToken?: string;
  authPath?: string;
}

/* Loads the local OAuth token without treating a missing Claude login as an error. */
async function readCredentials(): Promise<OAuthCreds | null> {
  try {
    const raw = JSON.parse(await Bun.file(CLAUDE_CREDENTIALS_PATH).text());
    const oauth = raw?.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    return { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt };
  } catch {
    return null;
  }
}

/* Narrows an untrusted quota object into the stable usage-window contract. */
function toWindow(w: unknown): UsageWindow | undefined {
  if (!w || typeof w !== "object") return undefined;
  const obj = w as { utilization?: unknown; resets_at?: unknown };
  if (typeof obj.utilization !== "number") return undefined;
  return { utilization: obj.utilization, resetsAt: typeof obj.resets_at === "string" ? obj.resets_at : null };
}

function isObj(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function title(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatWindowMinutes(minutes: number | undefined): string | undefined {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return undefined;
  if (minutes < 60) return `${Math.round(minutes)}m window`;
  const hours = minutes / 60;
  if (hours < 48) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h window`;
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)}d window`;
}

function unixOrIsoToIso(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) return unixOrIsoToIso(asNumber);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const ms = value > 1_000_000_000_000 ? value : value * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined;
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

async function readCodexAuth(): Promise<CodexAuth | null> {
  const envToken = nonEmpty(process.env.CODEX_ACCESS_TOKEN);
  const authPath = join(codexHome(), "auth.json");

  try {
    const raw = JSON.parse(await Bun.file(authPath).text());
    const tokens = isObj(raw?.tokens) ? raw.tokens : undefined;
    const token =
      envToken ||
      nonEmpty(tokens?.access_token) ||
      nonEmpty(raw?.personal_access_token);
    if (!token) return null;

    const idToken = typeof tokens?.id_token === "string" ? tokens.id_token : undefined;
    const idClaims = isObj(tokens?.id_token) ? tokens.id_token : decodeJwtPayload(idToken);
    const accessClaims = decodeJwtPayload(token);
    const accountId =
      nonEmpty(tokens?.account_id) ||
      nonEmpty(idClaims?.chatgpt_account_id) ||
      nonEmpty(accessClaims?.chatgpt_account_id);
    const fedramp =
      bool(idClaims?.chatgpt_account_is_fedramp) ??
      bool(accessClaims?.chatgpt_account_is_fedramp);

    return {
      token,
      accountId,
      fedramp,
      refreshToken: envToken ? undefined : nonEmpty(tokens?.refresh_token),
      authPath,
    };
  } catch {
    if (!envToken) return null;
    const claims = decodeJwtPayload(envToken);
    return {
      token: envToken,
      accountId: nonEmpty(claims?.chatgpt_account_id),
      fedramp: bool(claims?.chatgpt_account_is_fedramp),
    };
  }
}

async function refreshCodexAuth(auth: CodexAuth): Promise<CodexAuth | null> {
  if (!auth.refreshToken || !auth.authPath) return null;

  let res: Response;
  try {
    res = await fetch(process.env.CODEX_REFRESH_TOKEN_URL_OVERRIDE?.trim() || CODEX_REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.CODEX_APP_SERVER_LOGIN_CLIENT_ID?.trim() || CODEX_OAUTH_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: auth.refreshToken,
      }),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let refreshed: unknown;
  try {
    refreshed = await res.json();
  } catch {
    return null;
  }
  if (!isObj(refreshed)) return null;

  const accessToken = nonEmpty(refreshed.access_token);
  const refreshToken = nonEmpty(refreshed.refresh_token);
  const idToken = nonEmpty(refreshed.id_token);
  if (!accessToken && !refreshToken && !idToken) return null;

  try {
    const raw = JSON.parse(await Bun.file(auth.authPath).text());
    const tokens = isObj(raw?.tokens) ? { ...raw.tokens } : {};
    if (accessToken) tokens.access_token = accessToken;
    if (refreshToken) tokens.refresh_token = refreshToken;
    if (idToken) tokens.id_token = idToken;
    raw.tokens = tokens;
    raw.last_refresh = new Date().toISOString();
    await Bun.write(auth.authPath, JSON.stringify(raw, null, 2));
  } catch {
    return accessToken
      ? {
          ...auth,
          token: accessToken,
          refreshToken: refreshToken ?? auth.refreshToken,
          accountId: auth.accountId ?? nonEmpty(decodeJwtPayload(idToken)?.chatgpt_account_id),
        }
      : null;
  }

  return readCodexAuth();
}

async function fetchCodexJson(url: string, auth: CodexAuth): Promise<{ ok: true; data: unknown } | { ok: false; status?: number; error: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    "User-Agent": "codex-cli",
  };
  if (auth.accountId) headers["ChatGPT-Account-ID"] = auth.accountId;
  if (auth.fedramp) headers["X-OpenAI-Fedramp"] = "true";

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (e: any) {
    return { ok: false, error: e?.message ? `Couldn't reach the Codex usage API: ${e.message}` : "Couldn't reach the Codex usage API." };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, error: "Codex session expired. Run `codex login`, re-authenticate, then try again." };
  }
  if (!res.ok) return { ok: false, status: res.status, error: `Codex usage request failed (HTTP ${res.status}).` };

  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, error: "Codex usage API returned an unreadable response." };
  }
}

function codexWindow(label: string, raw: unknown): UsageLimitWindow | undefined {
  if (!isObj(raw)) return undefined;
  const utilization = num(raw.used_percent ?? raw.usedPercent ?? raw.utilization);
  if (utilization == null) return undefined;
  const windowMinutes =
    num(raw.window_minutes ?? raw.windowMinutes) ??
    (num(raw.limit_window_seconds ?? raw.limitWindowSeconds) != null
      ? Math.ceil(num(raw.limit_window_seconds ?? raw.limitWindowSeconds)! / 60)
      : undefined);

  return {
    label,
    utilization,
    resetsAt: unixOrIsoToIso(raw.reset_at ?? raw.resetAt ?? raw.resets_at),
    detail: formatWindowMinutes(windowMinutes),
  };
}

function addCodexLimitWindows(windows: UsageLimitWindow[], labelBase: string, rateLimit: unknown) {
  if (!isObj(rateLimit)) return;
  const primary = codexWindow(`${labelBase} primary`, rateLimit.primary_window ?? rateLimit.primary);
  const secondary = codexWindow(`${labelBase} secondary`, rateLimit.secondary_window ?? rateLimit.secondary);
  if (primary) windows.push(primary);
  if (secondary) windows.push(secondary);
}

export function parseCodexUsagePayload(data: unknown): Pick<UsageResult, "windows" | "stats"> {
  const root = isObj(data) ? data : {};
  const windows: UsageLimitWindow[] = [];
  const stats: UsageStat[] = [];

  addCodexLimitWindows(windows, "Codex", root.rate_limit ?? root.rate_limits);

  const additional = Array.isArray(root.additional_rate_limits) ? root.additional_rate_limits : [];
  for (const item of additional) {
    if (!isObj(item)) continue;
    const name = nonEmpty(item.limit_name) || nonEmpty(item.metered_feature) || "Additional";
    addCodexLimitWindows(windows, title(name), item.rate_limit);
  }

  const plan = nonEmpty(root.plan_type);
  if (plan) stats.push({ label: "Plan", value: title(plan) });

  if (isObj(root.credits)) {
    const unlimited = bool(root.credits.unlimited);
    const hasCredits = bool(root.credits.has_credits);
    const balance = nonEmpty(root.credits.balance);
    const value = unlimited ? "Unlimited" : balance ? `$${balance}` : hasCredits === false ? "Unavailable" : hasCredits ? "Available" : undefined;
    if (value) stats.push({ label: "Credits", value });
  }

  if (isObj(root.rate_limit_reset_credits)) {
    const count = num(root.rate_limit_reset_credits.available_count);
    if (count != null) stats.push({ label: "Reset credits", value: formatNumber(count) });
  }

  const individualLimit = isObj(root.spend_control)
    ? root.spend_control.individual_limit
    : undefined;
  if (isObj(individualLimit)) {
    const limit = nonEmpty(individualLimit.limit);
    const used = nonEmpty(individualLimit.used);
    const remaining = num(individualLimit.remaining_percent);
    const parts = [
      used && limit ? `${used} / ${limit}` : undefined,
      remaining != null ? `${Math.round(remaining)}% remaining` : undefined,
    ].filter(Boolean);
    if (parts.length) stats.push({ label: "Usage limit", value: parts.join(" · ") });
  }

  return { windows, stats };
}

export function parseCodexProfileStats(data: unknown): UsageStat[] {
  const stats = isObj(data) && isObj(data.stats) ? data.stats : isObj(data) ? data : {};
  const rows: UsageStat[] = [];
  const fields: Array<[string, string]> = [
    ["lifetime_tokens", "Lifetime tokens"],
    ["peak_daily_tokens", "Peak daily tokens"],
    ["longest_running_turn_sec", "Longest turn"],
    ["current_streak_days", "Current streak"],
    ["longest_streak_days", "Longest streak"],
  ];

  for (const [key, label] of fields) {
    const value = num(stats[key]);
    if (value == null) continue;
    const suffix = key.endsWith("_sec") ? "s" : key.endsWith("_days") ? "d" : "";
    rows.push({ label, value: `${formatNumber(value)}${suffix}` });
  }

  if (Array.isArray(stats.daily_usage_buckets) && stats.daily_usage_buckets.length) {
    const latest = stats.daily_usage_buckets[stats.daily_usage_buckets.length - 1];
    if (isObj(latest)) {
      const tokens = num(latest.tokens);
      const date = nonEmpty(latest.start_date);
      if (tokens != null && date) rows.push({ label: `Tokens on ${date}`, value: formatNumber(tokens) });
    }
  }

  return rows;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function redactSecrets(text: string): string {
  return stripAnsi(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|at)-[A-Za-z0-9._-]{8,}\b/g, "[redacted]");
}

function addStat(rows: UsageStat[], seen: Set<string>, label: string, value: string) {
  const cleanLabel = title(label.replace(/[•·]/g, " "));
  const cleanValue = value.trim();
  if (!cleanLabel || !cleanValue) return;
  const key = `${cleanLabel.toLowerCase()}:${cleanValue}`;
  if (seen.has(key)) return;
  seen.add(key);
  rows.push({ label: cleanLabel, value: cleanValue });
}

export function parseOpenCodeStats(output: string): UsageStat[] {
  const text = redactSecrets(output);
  const rows: UsageStat[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const simple = line.match(/^(total\s+cost|cost|total\s+tokens|tokens|input\s+tokens|output\s+tokens|cache\s+(?:read|write)|requests?)\s*[:=]\s*(.+)$/i);
    if (simple) addStat(rows, seen, simple[1], simple[2]);

    const cells = line
      .split(/[│|]/)
      .map((cell) => cell.trim())
      .filter(Boolean)
      .filter((cell) => !/^[─━═\-\s]+$/.test(cell));
    if (cells.length >= 2 && /[A-Za-z]/.test(cells[0]) && !/^model$/i.test(cells[0])) {
      addStat(rows, seen, cells[0], cells.slice(1).join(" · "));
    }
  }

  if (rows.length) return rows.slice(0, 12);

  return lines
    .filter((line) => !/^[╭╮╯╰┌┐└┘├┤┬┴┼─━═\-\s]+$/.test(line))
    .slice(0, 8)
    .map((line, index) => ({ label: index === 0 ? "Summary" : `Line ${index + 1}`, value: line }));
}

async function fetchOpenCodeUsage(): Promise<UsageResult> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["opencode", "stats", "--days", "7", "--models", "10"], {
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (e: any) {
    return { ok: false, error: e?.message ? `OpenCode stats failed to start: ${e.message}` : "OpenCode CLI was not found on PATH." };
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const detail = redactSecrets(stderr || stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-3).join(" ");
    return { ok: false, error: detail ? `OpenCode stats failed: ${detail}` : `OpenCode stats failed (exit ${exitCode}).` };
  }

  return { ok: true, stats: parseOpenCodeStats(stdout) };
}

/* Attaches provider metadata so the UI can label the returned usage consistently. */
function withTarget(result: UsageResult, target: UsageTarget): UsageResult {
  const support = usageSupportForTarget(target);
  return { ...result, provider: support.provider, providerLabel: support.providerLabel, target };
}

/* Fetches and normalizes Claude subscription usage for the status panel. */
async function fetchClaudeUsage(): Promise<UsageResult> {
  const creds = await readCredentials();
  if (!creds) {
    return { ok: false, error: "No Claude Code login found. Sign in with the `claude` CLI first." };
  }

  let res: Response;
  try {
    res = await fetch(CLAUDE_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "anthropic-beta": OAUTH_BETA,
        "Content-Type": "application/json",
      },
    });
  } catch (e: any) {
    return { ok: false, error: e?.message ? `Couldn't reach the usage API: ${e.message}` : "Couldn't reach the usage API." };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "Claude Code session expired. Run `claude`, re-authenticate, then try again." };
  }
  if (!res.ok) {
    return { ok: false, error: `Usage request failed (HTTP ${res.status}).` };
  }

  try {
    const data: any = await res.json();
    return {
      ok: true,
      fiveHour: toWindow(data.five_hour),
      sevenDay: toWindow(data.seven_day),
      sevenDayOpus: toWindow(data.seven_day_opus),
      extraUsage: data.extra_usage
        ? {
            enabled: !!data.extra_usage.is_enabled,
            utilization: typeof data.extra_usage.utilization === "number" ? data.extra_usage.utilization : null,
          }
        : undefined,
    };
  } catch {
    return { ok: false, error: "Usage API returned an unreadable response." };
  }
}

/* Fetches Codex account usage using the same local ChatGPT auth Codex stores. */
async function fetchCodexUsage(): Promise<UsageResult> {
  const auth = await readCodexAuth();
  if (!auth) {
    return { ok: false, error: "No Codex ChatGPT login found. Sign in with `codex login` first." };
  }

  let activeAuth = auth;
  let usage = await fetchCodexJson(CODEX_USAGE_URL, activeAuth);
  if (!usage.ok && (usage.status === 401 || usage.status === 403)) {
    const refreshed = await refreshCodexAuth(activeAuth);
    if (refreshed) {
      activeAuth = refreshed;
      usage = await fetchCodexJson(CODEX_USAGE_URL, activeAuth);
    }
  }
  if (!usage.ok) return { ok: false, error: usage.error };

  const parsed = parseCodexUsagePayload(usage.data);
  const profile = await fetchCodexJson(CODEX_PROFILE_URL, activeAuth);
  const stats = [
    ...(parsed.stats ?? []),
    ...(profile.ok ? parseCodexProfileStats(profile.data) : []),
  ];

  return {
    ok: true,
    windows: parsed.windows,
    stats,
  };
}

/* Fetches usage for the selected engine/model when a compatible provider exists. */
export async function fetchUsageForTarget(target: UsageTarget): Promise<UsageResult> {
  const support = usageSupportForTarget(target);
  if (!support.supported) {
    return {
      ok: false,
      unsupported: true,
      error: support.reason,
      target,
    };
  }

  if (support.provider === "claude-code") {
    return withTarget(await fetchClaudeUsage(), target);
  }

  if (support.provider === "codex") {
    return withTarget(await fetchCodexUsage(), target);
  }

  if (support.provider === "opencode") {
    return withTarget(await fetchOpenCodeUsage(), target);
  }

  return {
    ok: false,
    unsupported: true,
    error: "Usage checking is not available for the selected engine and model.",
    target,
  };
}
