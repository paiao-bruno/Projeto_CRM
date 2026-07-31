/**
 * Valida que o alvo é um banco PostgreSQL descartável antes de operações destrutivas.
 */

const BLOCKED_DB_NAMES = new Set([
  "isp_crm",
  "isp_crm_shadow",
  "postgres",
  "production",
  "prod",
  "homolog",
  "homologacao",
  "staging",
]);

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function parseDatabaseTarget(connectionString) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL inválida.");
  }

  const host = parsed.hostname || "localhost";
  const port = Number(parsed.port || 5432);
  const database = parsed.pathname.replace(/^\//, "").split("?")[0] || "";
  const schema = parsed.searchParams.get("schema") ?? "public";

  return { host, port, database, schema, connectionString };
}

export function assertDisposableDatabase(connectionString, options = {}) {
  const requireFlag = options.requireFlag ?? true;
  const target = parseDatabaseTarget(connectionString);

  if (requireFlag && process.env.ALLOW_DISPOSABLE_DB !== "true") {
    throw new Error(
      "Operação destrutiva recusada: defina ALLOW_DISPOSABLE_DB=true para confirmar banco descartável.",
    );
  }

  if (!ALLOWED_HOSTS.has(target.host)) {
    throw new Error(
      `Operação destrutiva recusada: host "${target.host}" não é local/desenvolvimento.`,
    );
  }

  if (BLOCKED_DB_NAMES.has(target.database.toLowerCase())) {
    throw new Error(
      `Operação destrutiva recusada: banco "${target.database}" não é exclusivo para teste.`,
    );
  }

  if (!target.database.toLowerCase().includes("test") && !target.database.toLowerCase().endsWith("_e2e")) {
    throw new Error(
      `Operação destrutiva recusada: use um banco de teste com sufixo "_e2e" ou "test" no nome (atual: "${target.database}").`,
    );
  }

  if (target.schema !== "public") {
    throw new Error(
      `Operação destrutiva recusada: schema "${target.schema}" deve ser "public" em banco descartável.`,
    );
  }

  return target;
}

export const DEFAULT_E2E_DATABASE_URL =
  "postgresql://crm:crm@localhost:5432/isp_crm_web_e2e?schema=public";
