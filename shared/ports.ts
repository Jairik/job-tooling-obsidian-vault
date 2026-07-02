import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

export const DEFAULT_PORT = 5173;

/* Parses simple KEY=VALUE .env files without overriding shell-provided env vars. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();

    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    const quote = value[0];
    if ((quote === `"` || quote === `'`) && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === `"`) value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
    } else {
      const commentIdx = value.search(/\s#/);
      if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
    }

    out[key] = value;
  }

  return out;
}

/* Loads .env from the current working directory unless another path is supplied. */
export function loadDotEnv(path = ".env", env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) return {};

  const parsed = parseDotEnv(readFileSync(fullPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) env[key] = value;
  }
  return parsed;
}

function positivePort(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return undefined;
  return parsed;
}

export function resolveAppPort(env: Record<string, string | undefined> = process.env): number {
  return positivePort(env.PORT) ?? DEFAULT_PORT;
}
