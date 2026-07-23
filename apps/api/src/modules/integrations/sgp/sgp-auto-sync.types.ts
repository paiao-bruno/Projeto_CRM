export type SgpAutoSyncConfig = {
  enabled: boolean;
  cron?: string;
  intervalMinutes: number;
  retryAttempts: number;
  retryDelayMs: number;
  timeoutMs: number;
  lastRunAt?: string;
  lastStatus?: "completed" | "failed" | "skipped" | "running";
  lastError?: string;
  nextRunAt?: string;
};

export type SgpAutoSyncRuntimeUpdate = {
  lastRunAt: string;
  lastStatus: SgpAutoSyncConfig["lastStatus"];
  lastError?: string | null;
  nextRunAt?: string | null;
};

export type SgpAutoSyncEnvDefaults = {
  enabled: boolean;
  cron?: string;
  intervalMinutes: number;
  retryAttempts: number;
  retryDelayMs: number;
  timeoutMs: number;
};
