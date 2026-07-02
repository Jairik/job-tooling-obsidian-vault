import {
  effectiveCleanupModel,
  effectiveCleanupReasoning,
  effectiveEngineModel,
  effectiveEngineReasoning,
  mergeEngineSettings,
  toEffort,
  type CoreSettings,
  type Engine,
} from "../../shared/settings";
import type { TuiMode } from "./modes";

export interface TerminalPreferences {
  defaultMode: TuiMode;
}

export function mergeTuiSettings(base: CoreSettings, patch: Partial<CoreSettings>): CoreSettings {
  return mergeEngineSettings(base, patch);
}

export function buildEnginePatch(settings: CoreSettings, engine: Engine): Partial<CoreSettings> {
  return { engine };
}

export function buildEngineModelPatch(settings: CoreSettings, model: string): Partial<CoreSettings> {
  const engine = settings.engine;
  return {
    engineModels: { ...(settings.engineModels ?? {}), [engine]: model },
    ...(engine === "claude" ? { model } : {}),
  };
}

export function buildEngineReasoningPatch(settings: CoreSettings, reasoning: string): Partial<CoreSettings> {
  const engine = settings.engine;
  const effort = engine === "claude" ? toEffort(reasoning) ?? settings.effort : settings.effort;
  return {
    engineReasoning: { ...(settings.engineReasoning ?? {}), [engine]: reasoning },
    ...(engine === "claude" ? { effort } : {}),
  };
}

export function buildCleanupModelPatch(settings: CoreSettings, model: string): Partial<CoreSettings> {
  const engine = settings.engine;
  return {
    cleanupModels: { ...(settings.cleanupModels ?? {}), [engine]: model },
    ...(engine === "claude" ? { cleanupModel: model } : {}),
  };
}

export function buildCleanupReasoningPatch(settings: CoreSettings, reasoning: string): Partial<CoreSettings> {
  const engine = settings.engine;
  return {
    cleanupReasoning: { ...(settings.cleanupReasoning ?? {}), [engine]: reasoning },
  };
}

export function currentModelValue(settings: CoreSettings): string {
  return effectiveEngineModel(settings);
}

export function currentReasoningValue(settings: CoreSettings): string {
  return effectiveEngineReasoning(settings);
}

export function currentCleanupModelValue(settings: CoreSettings): string {
  return effectiveCleanupModel(settings);
}

export function currentCleanupReasoningValue(settings: CoreSettings): string {
  return effectiveCleanupReasoning(settings);
}
