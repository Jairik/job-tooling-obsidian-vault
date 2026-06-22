// Reports the current Claude Code subscription usage — the same rolling 5-hour
// and 7-day limit utilization the CLI's `/usage` command shows. It reads the
// OAuth token Claude Code stores locally and calls Anthropic's OAuth usage API.
//
// This only applies to the Claude engine (it reuses Claude Code's own auth). The
// other engines shell out to third-party CLIs that don't expose a comparable,
// uniform usage endpoint, so the UI offers this button for Claude only.
import { homedir } from "os";
import { join } from "path";
import type { UsageResult, UsageWindow } from "../shared/usage";

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
// Beta header Claude Code sends on its OAuth API calls.
const OAUTH_BETA = "oauth-2025-04-20";

interface OAuthCreds {
  accessToken: string;
  expiresAt?: number;
}

/* Loads the local OAuth token without treating a missing Claude login as an error. */
async function readCredentials(): Promise<OAuthCreds | null> {
  try {
    const raw = JSON.parse(await Bun.file(CREDENTIALS_PATH).text());
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

/* Fetches and normalizes Claude subscription usage for the status panel. */
export async function fetchClaudeUsage(): Promise<UsageResult> {
  const creds = await readCredentials();
  if (!creds) {
    return { ok: false, error: "No Claude Code login found. Sign in with the `claude` CLI first." };
  }

  let res: Response;
  try {
    res = await fetch(USAGE_URL, {
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
