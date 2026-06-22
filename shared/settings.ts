/*
 * Shared settings primitives used by both the Bun server and the React client.
 * Keep this module dependency-free so neither runtime pulls in the other's code.
 */

export type Effort = "low" | "medium" | "high";
export type Engine = "claude" | "gemini" | "opencode" | "cursor" | "copilot" | "codex";
export type EngineModels = Partial<Record<Engine, string>>;
export type EngineReasoning = Partial<Record<Engine, string>>;
export type TabMode = "ask" | "job" | "write";
export type UrlFetchMethod = "basic";

export interface CoreSettings {
  engine: Engine;
  model: string;
  cleanupModel: string;
  effort: Effort;
  engineModels: EngineModels;
  engineReasoning: EngineReasoning;
  humanize: boolean;
  rag: boolean;
  maxTurns: number;
  persona: string;
  vaultDir: string;
  extraDirs: string[];
  urlFetchMethod?: UrlFetchMethod;
}

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
export const DEFAULT_CLEANUP_MODEL = "claude-haiku-4-5";

/* Returns a complete model map so newly added engines always have a safe value. */
export function defaultEngineModels(): Record<Engine, string> {
  return {
    claude: DEFAULT_CLAUDE_MODEL,
    gemini: "",
    opencode: "",
    cursor: "",
    copilot: "",
    codex: "",
  };
}

/* Returns a complete reasoning map with Claude's default thinking level. */
export function defaultEngineReasoning(): Record<Engine, string> {
  return {
    claude: "medium",
    gemini: "",
    opencode: "",
    cursor: "",
    copilot: "",
    codex: "",
  };
}

/* Converts an untrusted persisted value into a supported Claude effort level. */
export function toEffort(value: unknown): Effort | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

export interface EngineSettingsInput {
  model?: unknown;
  effort?: unknown;
  engineModels?: EngineModels;
  engineReasoning?: EngineReasoning;
}

export interface NormalizedEngineSettings {
  model: string;
  effort: Effort;
  engineModels: Record<Engine, string>;
  engineReasoning: Record<Engine, string>;
}

/*
 * Fills missing per-engine fields and preserves legacy Claude-only settings.
 * This keeps settings saved by older versions compatible with the current UI.
 */
export function normalizeEngineSettings(raw: EngineSettingsInput): NormalizedEngineSettings {
  const engineModels = { ...defaultEngineModels(), ...(raw.engineModels ?? {}) };
  const engineReasoning = { ...defaultEngineReasoning(), ...(raw.engineReasoning ?? {}) };
  if (typeof raw.model === "string" && raw.model.trim()) engineModels.claude = raw.model;
  if (typeof raw.effort === "string" && raw.effort.trim()) engineReasoning.claude = raw.effort;

  return {
    engineModels,
    engineReasoning,
    model: engineModels.claude || (typeof raw.model === "string" ? raw.model : "") || DEFAULT_CLAUDE_MODEL,
    effort: toEffort(engineReasoning.claude) ?? toEffort(raw.effort) ?? "medium",
  };
}

/* Merges a partial update without discarding model or reasoning values for other engines. */
export function mergeEngineSettings<T extends EngineSettingsInput>(base: T, patch: Partial<T>): T {
  return {
    ...base,
    ...patch,
    engineModels: { ...(base.engineModels ?? {}), ...(patch.engineModels ?? {}) },
    engineReasoning: { ...(base.engineReasoning ?? {}), ...(patch.engineReasoning ?? {}) },
  } as T;
}

/* Resolves the model that will actually be passed to the selected engine. */
export function effectiveEngineModel(settings: CoreSettings, engine: Engine = settings.engine): string {
  const configured = settings.engineModels?.[engine]?.trim();
  if (configured) return configured;
  return engine === "claude" ? settings.model || DEFAULT_CLAUDE_MODEL : "";
}

/* Resolves the engine-specific reasoning preference, including Claude's legacy fallback. */
export function effectiveEngineReasoning(settings: CoreSettings, engine: Engine = settings.engine): string {
  const configured = settings.engineReasoning?.[engine]?.trim();
  if (configured) return configured;
  return engine === "claude" ? settings.effort || "medium" : "";
}
