export const SGP_CHURN_REFRESH_MS = Number(process.env.SGP_CHURN_REFRESH_MS ?? 5 * 60 * 1000);
export const SGP_CHURN_STALE_RUNNING_MS = 20 * 60 * 1000;

export type SgpChurnLifecycle =
  | "needs_config"
  | "validating"
  | "syncing"
  | "ready"
  | "stale"
  | "unavailable"
  | "auth_denied";

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
}): SgpChurnLifecycle {
  if (!input.configured) return "needs_config";
  if (input.authDenied && !input.hasComplete) return "auth_denied";
  if (input.running && !input.hasComplete) return "syncing";
  if (input.running) return "validating";
  if (input.hasComplete && input.fresh) return "ready";
  if (input.hasComplete) return "stale";
  if (input.lastError) return "unavailable";
  return "validating";
}

export function displayCancellations(ready: boolean, count: number) {
  return ready ? count : null;
}
