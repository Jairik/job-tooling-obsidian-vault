import { parseTuiMode, type TuiMode } from "./modes";
import { resolveAppPort } from "../../shared/ports";

export interface ParsedLauncherArgs {
  tui: boolean;
  rest: string[];
}

export interface ParsedTuiArgs {
  help: boolean;
  port: number;
  serverUrl?: string;
  initialMode: TuiMode;
  fullScreen: boolean;
}

function stripSeparator(argv: string[]): string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

export function parseLauncherArgs(argv: string[]): ParsedLauncherArgs {
  const args = stripSeparator(argv);
  if (args[0] !== "--tui") return { tui: false, rest: args };
  return { tui: true, rest: args.slice(1) };
}

export function parseTuiArgs(argv: string[], env: Record<string, string | undefined> = process.env): ParsedTuiArgs {
  const args = stripSeparator(argv);
  let help = false;
  let port = resolveAppPort(env);
  let serverUrl: string | undefined;
  let initialMode: TuiMode = "ask";
  let fullScreen = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "--port") {
      const raw = args[++i];
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("--port requires a positive integer.");
      port = parsed;
    } else if (arg === "--server-url") {
      const raw = args[++i];
      if (!raw) throw new Error("--server-url requires a URL.");
      serverUrl = raw.replace(/\/+$/, "");
    } else if (arg === "--mode") {
      const raw = args[++i];
      const parsed = parseTuiMode(raw);
      if (parsed !== raw) throw new Error("--mode must be one of: ask, draft, write.");
      initialMode = parsed;
    } else if (arg === "--full-screen" || arg === "--fullscreen") {
      fullScreen = true;
    } else if (arg === "--tui") {
      // Accepted so run.sh can pass through an already-parsed argv in tests.
    } else {
      throw new Error(`Unknown TUI option: ${arg}`);
    }
  }

  return { help, port, serverUrl, initialMode, fullScreen };
}

export function formatTuiHelp(): string {
  return `Vault Assistant TUI

Usage:
  bun run tui -- [--port <number>] [--server-url <url>] [--mode ask|draft|write] [--full-screen]
  ./run.sh --tui [--port <number>] [--server-url <url>] [--mode ask|draft|write] [--full-screen]

Options:
  --port <number>       Port for the local server (default: PORT or 5173)
  --server-url <url>    Connect to an existing server and skip spawning one
  --mode <mode>         Initial mode: ask, draft, or write
  --full-screen         Render in the terminal's alternate screen buffer
  -h, --help            Show this help
`;
}
