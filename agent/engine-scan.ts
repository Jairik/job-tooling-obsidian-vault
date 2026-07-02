import { ENGINES, MODELS } from "./config";
import type { Engine } from "../shared/settings";
import type { EngineChoice, EngineScanEntry, EngineScanMap, EngineScanResult, ReasoningTransport } from "../shared/engine-scan";

const CLI_DEFAULT: EngineChoice = { id: "", label: "CLI default" };

export const ENGINE_CLI_NAMES: Record<Engine, string> = {
  claude: "Claude SDK",
  gemini: "agy",
  opencode: "opencode",
  cursor: "cursor-agent",
  copilot: "copilot",
  codex: "codex",
};

const ENGINE_MODELS: Record<Engine, EngineChoice[]> = {
  claude: MODELS,
  gemini: [
    CLI_DEFAULT,
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  opencode: [
    CLI_DEFAULT,
    { id: "openai/gpt-5", label: "OpenAI GPT-5" },
    { id: "anthropic/claude-sonnet-4-6", label: "Anthropic Claude Sonnet 4.6" },
    { id: "google/gemini-2.5-pro", label: "Google Gemini 2.5 Pro" },
  ],
  cursor: [
    CLI_DEFAULT,
    { id: "auto", label: "Auto" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  ],
  copilot: [
    CLI_DEFAULT,
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  ],
  codex: [
    CLI_DEFAULT,
    { id: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
    { id: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
    { id: "gpt-5-codex", label: "GPT-5 Codex" },
  ],
};

const ENGINE_REASONING: Record<Engine, EngineChoice[]> = {
  claude: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ],
  gemini: [
    CLI_DEFAULT,
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ],
  opencode: [
    CLI_DEFAULT,
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
    { id: "max", label: "Max" },
  ],
  cursor: [
    CLI_DEFAULT,
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ],
  copilot: [
    CLI_DEFAULT,
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ],
  codex: [
    CLI_DEFAULT,
    { id: "minimal", label: "Minimal" },
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ],
};

const REASONING_TRANSPORT: Record<Engine, ReasoningTransport> = {
  claude: "sdk",
  gemini: "prompt",
  opencode: "variant",
  cursor: "prompt",
  copilot: "flag",
  codex: "flag",
};

const MODEL_PLACEHOLDER: Record<Engine, string> = {
  claude: "model id",
  gemini: "gemini model id",
  opencode: "provider/model",
  cursor: "model id",
  copilot: "model id",
  codex: "model id",
};

/* Resolves the executable path used for a local CLI engine. */
export function cliPathForEngine(engine: Engine): string | undefined {
  if (engine === "claude") return undefined;
  if (engine === "gemini") return Bun.which("agy") ?? undefined;
  if (engine === "cursor") return Bun.which("cursor-agent") ?? Bun.which("cursor") ?? undefined;
  return Bun.which(ENGINE_CLI_NAMES[engine]) ?? undefined;
}

/* Converts the path scan and built-in command knowledge into UI-ready choices. */
export function scanEngines(now = Date.now()): EngineScanResult {
  const entries = {} as EngineScanMap;

  for (const engine of ENGINES) {
    const id = engine.id as Engine;
    const path = cliPathForEngine(id);
    const available = id === "claude" || Boolean(path);

    entries[id] = {
      id,
      label: engine.label,
      cliName: ENGINE_CLI_NAMES[id],
      available,
      path,
      models: ENGINE_MODELS[id],
      reasoning: ENGINE_REASONING[id],
      modelCustom: true,
      reasoningCustom: true,
      modelPlaceholder: MODEL_PLACEHOLDER[id],
      reasoningPlaceholder: id === "claude" ? "low, medium, high" : "CLI default or custom effort",
      reasoningTransport: REASONING_TRANSPORT[id],
    };
  }

  return { scannedAt: now, engines: entries };
}

/* The legacy skills status endpoint exposes CLI availability as booleans. */
export function engineAvailabilityStatus(scan: EngineScanResult): {
  gemini: boolean;
  opencode: boolean;
  cursor: boolean;
  copilot: boolean;
  codex: boolean;
} {
  return {
    gemini: scan.engines.gemini.available,
    opencode: scan.engines.opencode.available,
    cursor: scan.engines.cursor.available,
    copilot: scan.engines.copilot.available,
    codex: scan.engines.codex.available,
  };
}
