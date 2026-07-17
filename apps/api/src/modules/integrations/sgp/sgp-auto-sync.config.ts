import { Prisma } from "@prisma/client";
import {
  SgpAutoSyncConfig,
  SgpAutoSyncEnvDefaults,
} from "./sgp-auto-sync.types";

const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 24 * 60;

export function readEnvAutoSyncDefaults(env: NodeJS.ProcessEnv): SgpAutoSyncEnvDefaults {
  const intervalMinutes = parsePositiveInt(env.SGP_AUTO_SYNC_INTERVAL_MINUTES, 360);
  const cron = env.SGP_AUTO_SYNC_CRON?.trim() || undefined;

  return {
    enabled: env.SGP_AUTO_SYNC_ENABLED !== "false",
    cron,
    intervalMinutes: clamp(intervalMinutes, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES),
    retryAttempts: clamp(parsePositiveInt(env.SGP_AUTO_SYNC_RETRY_ATTEMPTS, 3), 1, 10),
    retryDelayMs: clamp(parsePositiveInt(env.SGP_AUTO_SYNC_RETRY_DELAY_MS, 60_000), 1_000, 3_600_000),
    timeoutMs: clamp(parsePositiveInt(env.SGP_AUTO_SYNC_TIMEOUT_MS, 900_000), 30_000, 7_200_000),
  };
}

export function readAutoSyncConfig(
  integrationConfig: Prisma.JsonValue | null | undefined,
  envDefaults: SgpAutoSyncEnvDefaults,
): SgpAutoSyncConfig {
  const stored = readStoredAutoSync(integrationConfig);

  return {
    enabled: stored.enabled ?? envDefaults.enabled,
    cron: stored.cron ?? envDefaults.cron,
    intervalMinutes: clamp(
      stored.intervalMinutes ?? envDefaults.intervalMinutes,
      MIN_INTERVAL_MINUTES,
      MAX_INTERVAL_MINUTES,
    ),
    retryAttempts: clamp(stored.retryAttempts ?? envDefaults.retryAttempts, 1, 10),
    retryDelayMs: clamp(stored.retryDelayMs ?? envDefaults.retryDelayMs, 1_000, 3_600_000),
    timeoutMs: clamp(stored.timeoutMs ?? envDefaults.timeoutMs, 30_000, 7_200_000),
    lastRunAt: stored.lastRunAt,
    lastStatus: stored.lastStatus,
    lastError: stored.lastError,
    nextRunAt: stored.nextRunAt,
  };
}

export function mergeAutoSyncConfig(
  integrationConfig: Prisma.JsonValue | null | undefined,
  patch: Partial<SgpAutoSyncConfig>,
): Prisma.InputJsonObject {
  const base =
    integrationConfig && typeof integrationConfig === "object" && !Array.isArray(integrationConfig)
      ? (integrationConfig as Record<string, Prisma.InputJsonValue | null>)
      : {};

  const current = readStoredAutoSync(integrationConfig);

  return {
    ...base,
    autoSync: {
      ...current,
      ...patch,
    },
  };
}

export function isAutoSyncDue(
  config: SgpAutoSyncConfig,
  lastRunAt: Date | null,
  now = new Date(),
) {
  if (!config.enabled) {
    return false;
  }

  if (!lastRunAt) {
    return true;
  }

  const elapsedMs = now.getTime() - lastRunAt.getTime();
  return elapsedMs >= config.intervalMinutes * 60_000;
}

export function computeNextRunAt(config: SgpAutoSyncConfig, from = new Date()) {
  if (!config.enabled) {
    return null;
  }

  return new Date(from.getTime() + config.intervalMinutes * 60_000).toISOString();
}

function readStoredAutoSync(
  integrationConfig: Prisma.JsonValue | null | undefined,
): Partial<SgpAutoSyncConfig> {
  if (!integrationConfig || typeof integrationConfig !== "object" || Array.isArray(integrationConfig)) {
    return {};
  }

  const autoSync = (integrationConfig as Record<string, unknown>).autoSync;
  if (!autoSync || typeof autoSync !== "object" || Array.isArray(autoSync)) {
    return {};
  }

  const record = autoSync as Record<string, unknown>;
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    cron: typeof record.cron === "string" ? record.cron : undefined,
    intervalMinutes:
      typeof record.intervalMinutes === "number" ? record.intervalMinutes : undefined,
    retryAttempts:
      typeof record.retryAttempts === "number" ? record.retryAttempts : undefined,
    retryDelayMs: typeof record.retryDelayMs === "number" ? record.retryDelayMs : undefined,
    timeoutMs: typeof record.timeoutMs === "number" ? record.timeoutMs : undefined,
    lastRunAt: typeof record.lastRunAt === "string" ? record.lastRunAt : undefined,
    lastStatus:
      record.lastStatus === "completed" ||
      record.lastStatus === "failed" ||
      record.lastStatus === "skipped" ||
      record.lastStatus === "running"
        ? record.lastStatus
        : undefined,
    lastError: typeof record.lastError === "string" ? record.lastError : undefined,
    nextRunAt: typeof record.nextRunAt === "string" ? record.nextRunAt : undefined,
  };
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
