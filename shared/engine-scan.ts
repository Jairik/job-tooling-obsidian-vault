import type { Engine } from "./settings";

export interface EngineChoice {
  id: string;
  label: string;
}

export type ReasoningTransport = "sdk" | "flag" | "variant" | "prompt";

export interface EngineScanEntry {
  id: Engine;
  label: string;
  cliName: string;
  available: boolean;
  path?: string;
  models: EngineChoice[];
  reasoning: EngineChoice[];
  modelCustom: boolean;
  reasoningCustom: boolean;
  modelPlaceholder: string;
  reasoningPlaceholder: string;
  reasoningTransport: ReasoningTransport;
}

export type EngineScanMap = Record<Engine, EngineScanEntry>;

export interface EngineScanResult {
  scannedAt: number;
  engines: EngineScanMap;
}
