import { ConfigService } from "@nestjs/config";

const PRODUCTION_REQUIRED_KEYS = [
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "ENCRYPTION_KEY",
  "APP_URL",
  "CORS_ORIGINS",
] as const;

export function assertProductionEnvironment(config: ConfigService) {
  if (config.get<string>("NODE_ENV") !== "production") {
    return;
  }

  const missing = PRODUCTION_REQUIRED_KEYS.filter((key) => !config.get<string>(key)?.trim());

  if (missing.length > 0) {
    throw new Error(
      `Variáveis obrigatórias ausentes em produção: ${missing.join(", ")}`,
    );
  }

  const encryptionKey = config.get<string>("ENCRYPTION_KEY") ?? "";
  if (encryptionKey.length < 32) {
    throw new Error("ENCRYPTION_KEY deve ter ao menos 32 caracteres em produção.");
  }

  const jwtSecret = config.get<string>("JWT_ACCESS_SECRET") ?? "";
  if (jwtSecret.length < 32) {
    throw new Error("JWT_ACCESS_SECRET deve ter ao menos 32 caracteres em produção.");
  }

  const corsOrigins = (config.get<string>("CORS_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (corsOrigins.length === 0) {
    throw new Error("CORS_ORIGINS deve listar ao menos uma origem em produção.");
  }

  if (corsOrigins.includes("*")) {
    throw new Error("CORS_ORIGINS não pode conter '*' quando credenciais estão habilitadas.");
  }

  const appUrl = config.get<string>("APP_URL") ?? "";
  if (!appUrl.startsWith("https://")) {
    throw new Error("APP_URL deve usar HTTPS em produção.");
  }
}

export function resolveRequiredSecret(
  config: ConfigService,
  key: "JWT_ACCESS_SECRET" | "DATABASE_URL",
  devFallback: string,
) {
  const value = config.get<string>(key)?.trim();

  if (value) {
    return value;
  }

  if (config.get<string>("NODE_ENV") === "production") {
    throw new Error(`${key} precisa estar configurada em produção.`);
  }

  return devFallback;
}
