/* The `/api/usage` response contract, shared to prevent server/client drift. */

export interface UsageWindow {
  utilization: number;
  resetsAt: string | null;
}

export interface UsageResult {
  ok: boolean;
  error?: string;
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  sevenDayOpus?: UsageWindow;
  extraUsage?: { enabled: boolean; utilization: number | null };
}
