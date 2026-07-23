export type SecurityConfig = {
  corsOrigins: string[];
  corsCredentials: boolean;
  corsMethods: string[];
  rateLimitTtlMs: number;
  rateLimitMax: number;
  authRateLimitMax: number;
  sanitizeRequests: boolean;
  sqlInjectionGuard: boolean;
  hideValidationDetails: boolean;
  bodySizeLimit: string;
  exposeInternalErrors: boolean;
};

export function readSecurityConfig(env: NodeJS.ProcessEnv): SecurityConfig {
  const appUrl = env.APP_URL ?? "http://localhost:3000";
  const corsOrigins = (env.CORS_ORIGINS ?? `${appUrl},http://localhost:3000`)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    corsOrigins,
    corsCredentials: env.CORS_CREDENTIALS !== "false",
    corsMethods: (env.CORS_METHODS ?? "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    rateLimitTtlMs: parsePositiveInt(env.RATE_LIMIT_TTL_MS, 60_000),
    rateLimitMax: parsePositiveInt(env.RATE_LIMIT_MAX, 100),
    authRateLimitMax: parsePositiveInt(env.AUTH_RATE_LIMIT_MAX, 10),
    sanitizeRequests: env.SECURITY_SANITIZE_REQUESTS !== "false",
    sqlInjectionGuard: env.SECURITY_SQL_INJECTION_GUARD !== "false",
    hideValidationDetails: env.NODE_ENV === "production",
    bodySizeLimit: env.REQUEST_BODY_LIMIT ?? "1mb",
    exposeInternalErrors: env.NODE_ENV !== "production",
  };
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
