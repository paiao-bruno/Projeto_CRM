export const SGP_CHURN_REFRESH_MS = Number(process.env.SGP_CHURN_REFRESH_MS ?? 5 * 60 * 1000);
export const SGP_CHURN_RETRY_MS = Number(process.env.SGP_CHURN_RETRY_MS ?? 60 * 1000);
export const SGP_CHURN_AUTH_RETRY_MS = Number(process.env.SGP_CHURN_AUTH_RETRY_MS ?? 15 * 60 * 1000);
export const SGP_CHURN_STALE_RUNNING_MS = 20 * 60 * 1000;
export const SGP_CHURN_WORKER_TICK_MS = Number(process.env.SGP_CHURN_WORKER_TICK_MS ?? 60 * 1000);

export type SgpChurnLifecycle =
  | "needs_config"
  | "validating"
  | "syncing"
  | "ready"
  | "stale"
  | "unavailable"
  | "auth_denied"
  | "decrypt_failed";

export function isSecretMask(value: unknown) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 4 && /^[•*xX]+$/.test(trimmed);
}

export function isFreshSnapshot(finishedAt: Date | null | undefined, now: Date, windowMs = SGP_CHURN_REFRESH_MS) {
  if (!finishedAt) return false;
  return now.getTime() - finishedAt.getTime() <= windowMs;
}

export function isStaleRunning(startedAt: Date, now: Date, limitMs = SGP_CHURN_STALE_RUNNING_MS) {
  return now.getTime() - startedAt.getTime() > limitMs;
}

export function canPublishSnapshot(jobCredentialVersion: number, currentCredentialVersion: number, jobHost: string, currentHost: string) {
  return jobCredentialVersion === currentCredentialVersion && jobHost === currentHost;
}

export function snapshotMatchesOrigin(
  metadata: unknown,
  integrationId: string | null | undefined,
  apiHost: string | null | undefined,
) {
  const row = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const metaHost = typeof row.apiHost === "string" ? row.apiHost : null;
  const metaIntegration = typeof row.integrationId === "string" ? row.integrationId : null;
  if (apiHost && metaHost && metaHost !== apiHost) return false;
  if (integrationId && metaIntegration && metaIntegration !== integrationId) return false;
  return true;
}

export function lifecycleFromState(input: {
  configured: boolean;
  authDenied: boolean;
  running: boolean;
  hasComplete: boolean;
  fresh: boolean;
  lastError?: string | null;
  decryptFailed?: boolean;
}): SgpChurnLifecycle {
  if (input.decryptFailed) return "decrypt_failed";
  if (!input.configured) return "needs_config";
  if (input.running && !input.hasComplete) return "syncing";
  if (input.running) return "validating";
  if (input.authDenied && !input.hasComplete) return "auth_denied";
  if (input.hasComplete && input.fresh) return "ready";
  if (input.hasComplete) return "stale";
  if (input.lastError) return "unavailable";
  return "validating";
}

export function displayCancellations(ready: boolean, count: number) {
  return ready ? count : null;
}

/** Ordem: validada, dedicada de cancelamentos, demais SGP do mesmo tenant. */
export function rankSgpChurnCandidates<T extends { authState: string; dedicated: boolean; updatedAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const score = (row: T) =>
      (row.authState === "ok" ? 8 : 0) + (row.authState !== "denied" ? 4 : 0) + (row.dedicated ? 2 : 0);
    const diff = score(b) - score(a);
    if (diff) return diff;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}

export function allSgpCandidatesDenied(rows: { authState: string }[]) {
  return rows.length > 0 && rows.every((row) => row.authState === "denied");
}

/** Evita martelar o SGP após recusa, mas permite uma nova validação após reinício do processo. */
export function shouldSkipDeniedAuth(input: {
  force: boolean;
  allDenied: boolean;
  retriedThisProcess: boolean;
  lastAuthDeniedAt: Date | null;
  now: Date;
  cooldownMs?: number;
}) {
  if (input.force || !input.allDenied) return false;
  if (!input.retriedThisProcess) return false;
  const cooldown = input.cooldownMs ?? SGP_CHURN_AUTH_RETRY_MS;
  if (!input.lastAuthDeniedAt) return false;
  return isFreshSnapshot(input.lastAuthDeniedAt, input.now, cooldown);
}

export function shouldPollChurnLifecycle(_lifecycle: SgpChurnLifecycle) {
  return true;
}

export function churnPollIntervalMs(lifecycle: SgpChurnLifecycle) {
  if (lifecycle === "syncing" || lifecycle === "validating" || lifecycle === "stale") return 5_000;
  if (lifecycle === "unavailable") return 15_000;
  if (lifecycle === "ready") return 60_000;
  if (lifecycle === "auth_denied") return 30_000;
  return 30_000;
}

export function nextChurnAttemptAt(input: {
  lifecycle: SgpChurnLifecycle;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  now: Date;
  refreshMs?: number;
  retryMs?: number;
}) {
  const refreshMs = input.refreshMs ?? SGP_CHURN_REFRESH_MS;
  const retryMs = input.retryMs ?? SGP_CHURN_RETRY_MS;
  if (input.lifecycle === "needs_config" || input.lifecycle === "auth_denied" || input.lifecycle === "decrypt_failed") return null;
  if (input.lifecycle === "syncing" || input.lifecycle === "validating") return input.now.toISOString();
  if (input.lifecycle === "ready" && input.lastSuccessAt) {
    return new Date(input.lastSuccessAt.getTime() + refreshMs).toISOString();
  }
  if (input.lastAttemptAt) return new Date(input.lastAttemptAt.getTime() + retryMs).toISOString();
  return input.now.toISOString();
}

export function preferFresherPayload<T extends { generatedAt?: string }>(current: T | null, incoming: T) {
  if (!current?.generatedAt || !incoming.generatedAt) return incoming;
  return incoming.generatedAt >= current.generatedAt ? incoming : current;
}

export function isChurnRealtimeEvent(type: string) {
  return type === "sgp.churn.updated" || type === "sgp.churn.failed";
}
