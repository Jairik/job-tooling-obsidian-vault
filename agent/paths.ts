// Resolves where the app keeps its writable state (config.json, logs/,
// .attachments/, .sessions.json). By default this is the repo root — matching the
// original layout, so `./run.sh` and Docker are unaffected. When the app is bundled
// (e.g. a Tauri build spawning a `bun build --compile` sidecar), the source dir is
// read-only, so the host sets VA_DATA_DIR to a writable per-user location and every
// writable path is rooted there instead.
import { join } from "path";

/* Root directory for writable application state. */
export function dataDir(): string {
  const override = process.env.VA_DATA_DIR;
  if (override && override.trim()) return override;
  return join(import.meta.dir, "..");
}
