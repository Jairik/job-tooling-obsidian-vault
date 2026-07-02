// Server lifecycle for the TUI. The TUI is a thin client of the existing Bun
// server (server.ts). If a server is already listening on the chosen port we just
// use it; otherwise we spawn one and tear it back down on exit. A server we did
// NOT start (e.g. `bun run dev` in another terminal) is left untouched.
import { join } from "path";
import { setBaseUrl } from "./api";

/* Resolves true when the API answers on the given port within the timeout. */
async function ping(port: number, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/meta`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ServerHandle {
  spawned: boolean;
  stop: () => void;
}

/* Points the API client at the port and guarantees a server is reachable there. */
export async function ensureServer(port: number): Promise<ServerHandle> {
  setBaseUrl(`http://localhost:${port}`);

  if (await ping(port)) return { spawned: false, stop: () => {} };

  const root = join(import.meta.dir, "..", "..");
  const proc = Bun.spawn(["bun", "server.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
    stdout: "ignore",
    stderr: "ignore",
  });

  const stop = () => {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
  };

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    await Bun.sleep(300);
    if (await ping(port)) return { spawned: true, stop };
    if (proc.exitCode !== null) break; // process died early
  }

  stop();
  throw new Error(
    `Could not reach the Vault Assistant server on port ${port}. ` +
      `Try starting it manually with \`bun run dev\` and rerun the TUI.`
  );
}
