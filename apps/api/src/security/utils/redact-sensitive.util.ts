const SENSITIVE_KEYS = new Set([
  "token",
  "senha",
  "password",
  "authorization",
  "app",
  "secret",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
  "encryptedsecrets",
  "encrypted_secrets",
  "passwordhash",
  "password_hash",
]);

const TOKEN_LIKE = /^(Bearer\s+)?[A-Za-z0-9._\-+/=]{8,}$/;

export function redactSensitiveValue(key: string, value: unknown): unknown {
  const normalizedKey = key.toLowerCase();

  if (SENSITIVE_KEYS.has(normalizedKey)) {
    if (typeof value === "string" && value.length <= 4) {
      return "***";
    }
    if (typeof value === "string") {
      return `${value.slice(0, 2)}***${value.slice(-2)}`;
    }
    return "[REDACTED]";
  }

  if (typeof value === "string" && TOKEN_LIKE.test(value)) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }

  return value;
}

export function redactSensitiveData<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        redactSensitiveValue(key, redactValue(nested)),
      ]),
    );
  }

  return value;
}

export function safeJsonStringify(value: unknown) {
  return JSON.stringify(redactSensitiveData(value));
}
