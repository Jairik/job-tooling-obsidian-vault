import type { TabMode } from "../../shared/settings";

export type TuiMode = "ask" | "draft" | "write";

export const TUI_MODE_ORDER: TuiMode[] = ["ask", "draft", "write"];
export const BACKEND_MODE_ORDER: TabMode[] = ["ask", "job", "write"];

export const TUI_MODE_LABEL: Record<TuiMode, string> = {
  ask: "Ask",
  draft: "Draft",
  write: "Write",
};

export const BACKEND_MODE_LABEL: Record<TabMode, string> = {
  ask: "Ask",
  job: "Draft",
  write: "Write",
};

export function toBackendMode(mode: TuiMode): TabMode {
  return mode === "draft" ? "job" : mode;
}

export function fromBackendMode(mode: TabMode): TuiMode {
  return mode === "job" ? "draft" : mode;
}

export function parseTuiMode(value: string | undefined, fallback: TuiMode = "ask"): TuiMode {
  if (value === "ask" || value === "draft" || value === "write") return value;
  return fallback;
}

export function nextBackendMode(mode: TabMode): TabMode {
  const idx = BACKEND_MODE_ORDER.indexOf(mode);
  return BACKEND_MODE_ORDER[(idx + 1) % BACKEND_MODE_ORDER.length];
}

export interface TabBarItem {
  key: string;
  label: string;
  isActive: boolean;
}

export function getTabBarInfo(currentMode: TabMode, currentWriteMode?: string): { modes: TabBarItem[]; submodes: TabBarItem[] } {
  const modes = [
    { key: "ask", label: "Ask", isActive: currentMode === "ask" },
    { key: "job", label: "Draft", isActive: currentMode === "job" },
    { key: "write", label: "Write", isActive: currentMode === "write" },
  ];
  const submodes = currentMode === "write" ? [
    { key: "manual", label: "manual", isActive: currentWriteMode === "manual" },
    { key: "summarize", label: "summarize", isActive: currentWriteMode === "summarize" },
    { key: "fillin", label: "fillin", isActive: currentWriteMode === "fillin" },
    { key: "document", label: "document", isActive: currentWriteMode === "document" },
  ] : [];
  return { modes, submodes };
}


