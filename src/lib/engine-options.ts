import type { Engine } from "../../shared/settings";
import type { EngineScanResult } from "../../shared/engine-scan";
import type { ModelOption } from "./api";

export const OTHER_OPTION = "__other__";

const CLI_MODEL_FALLBACK: ModelOption[] = [
  { id: "", label: "CLI default" },
  { id: "auto", label: "Auto" },
];

const CLAUDE_REASONING_FALLBACK: ModelOption[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

const CLI_REASONING_FALLBACK: ModelOption[] = [
  { id: "", label: "CLI default" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "minimal", label: "Minimal" },
  { id: "max", label: "Max" },
  { id: "xhigh", label: "XHigh" },
];

function dedupeOptions(options: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  const out: ModelOption[] = [];
  for (const option of options) {
    if (seen.has(option.id)) continue;
    seen.add(option.id);
    out.push(option);
  }
  return out;
}

export function modelOptionsForEngine(
  scan: EngineScanResult | null | undefined,
  engine: Engine,
  fallbackModels: ModelOption[]
): ModelOption[] {
  const scanned = scan?.engines?.[engine]?.models;
  if (scanned?.length) return dedupeOptions(scanned);
  return engine === "claude" ? fallbackModels : CLI_MODEL_FALLBACK;
}

export function reasoningOptionsForEngine(
  scan: EngineScanResult | null | undefined,
  engine: Engine
): ModelOption[] {
  const scanned = scan?.engines?.[engine]?.reasoning;
  if (scanned?.length) return dedupeOptions(scanned);
  return engine === "claude" ? CLAUDE_REASONING_FALLBACK : CLI_REASONING_FALLBACK;
}

export function optionValue(current: string, options: ModelOption[], forceOther: boolean): string {
  if (forceOther) return OTHER_OPTION;
  return options.some((option) => option.id === current) ? current : OTHER_OPTION;
}
