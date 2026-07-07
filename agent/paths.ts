// Resolves where the app keeps its writable state (config.json, logs/,
// .attachments/, .sessions.json). By default this is the repo root — matching the
// original layout, so `./run.sh` and Docker are unaffected. When the app is bundled
// (e.g. a Tauri build spawning a `bun build --compile` sidecar), the source dir is
// read-only, so the host sets VA_DATA_DIR to a writable per-user location and every
// writable path is rooted there instead. A global npm/bun install has no host to set
// VA_DATA_DIR for it, so if the repo-root fallback turns out not to be writable
// (e.g. a system-owned global install prefix), this falls back further to a
// per-user XDG-style data directory.
import { accessSync, constants, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function xdgDataDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "vault-assistant");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "vault-assistant");
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "vault-assistant");
}

function isWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/* Root directory for writable application state. */
export function dataDir(): string {
  const override = process.env.VA_DATA_DIR;
  if (override && override.trim()) return override;

  const installDir = join(import.meta.dir, "..");
  if (isWritable(installDir)) return installDir;

  const fallback = xdgDataDir();
  try {
    mkdirSync(fallback, { recursive: true, mode: 0o700 });
  } catch {
    /* best effort — the first real write will surface its own clear error */
  }
  return fallback;
}
