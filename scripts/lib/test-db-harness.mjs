/**
 * Harness compartilhado de bancos PostgreSQL descartáveis para testes de integração.
 *
 * Contrato:
 * - A conexão administrativa vem SOMENTE de TEST_DATABASE_ADMIN_URL (variável criada por esta
 *   correção). Não há fallback para DATABASE_URL, banco da aplicação ou crm:crm@localhost.
 * - Cada execução cria bancos próprios (vtest_<runId> e, se pedido, vtest_<runId>_shadow), marcados
 *   com COMMENT ON DATABASE 'vertice-test-run:<runId>'. A limpeza só remove bancos cujo marcador
 *   confere com o runId da execução.
 * - O destino administrativo é validado (host local, banco de manutenção, versão, extensões) antes
 *   de qualquer operação destrutiva; nome contendo "test" não é considerado proteção.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const require = createRequire(import.meta.url);
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const MAINTENANCE_DATABASES = new Set(["postgres", "template1"]);
const REQUIRED_EXTENSIONS = ["vector", "pgcrypto"];
const MARKER_PREFIX = "vertice-test-run:";
const DB_NAME_PATTERN = /^vtest_[a-z0-9]{6,24}(_shadow)?$/;

export class HarnessError extends Error {
  constructor(message, code = "HARNESS_ERROR") {
    super(message);
    this.code = code;
  }
}

export const PREPARE_HINT =
  "Preparação: suba um PostgreSQL com pgvector (ex.: `docker compose up -d postgres`) e defina " +
  'TEST_DATABASE_ADMIN_URL="postgresql://USUARIO:SENHA@localhost:PORTA/postgres" ' +
  "(usuário com permissão CREATEDB e para criar extensões).";

export function readAdminUrl(env = process.env) {
  const raw = env.TEST_DATABASE_ADMIN_URL?.trim();
  if (!raw) {
    throw new HarnessError(`TEST_DATABASE_ADMIN_URL não definida. ${PREPARE_HINT}`, "MISSING_ADMIN_URL");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HarnessError("TEST_DATABASE_ADMIN_URL inválida (não é uma URL).", "INVALID_ADMIN_URL");
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new HarnessError("TEST_DATABASE_ADMIN_URL deve usar postgresql://.", "INVALID_ADMIN_URL");
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new HarnessError(
      `Destino recusado: host "${url.hostname}" não é local. Testes destrutivos só rodam em PostgreSQL local.`,
      "REFUSED_TARGET",
    );
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!MAINTENANCE_DATABASES.has(database)) {
    throw new HarnessError(
      `Destino recusado: a conexão administrativa deve apontar para o banco de manutenção (postgres/template1), não para "${database}".`,
      "REFUSED_TARGET",
    );
  }
  return url;
}

export function urlForDatabase(adminUrl, database) {
  const url = new URL(adminUrl.toString());
  url.pathname = `/${database}`;
  url.search = "?schema=public";
  return url.toString();
}

export function newRunId() {
  return `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
}

export async function waitForPostgres(
  connectionString,
  { timeoutMs = Number(process.env.TEST_DATABASE_READY_TIMEOUT_MS) || 15_000, intervalMs = 250 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const client = new Client({ connectionString, connectionTimeoutMillis: 2000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await sleep(intervalMs);
    }
  }
  const target = new URL(connectionString);
  throw new HarnessError(
    `PostgreSQL indisponível em ${target.hostname}:${target.port || 5432} após ${timeoutMs} ms ` +
      `(${lastError?.code ?? lastError?.message ?? "sem detalhe"}). ${PREPARE_HINT}`,
    "DB_UNAVAILABLE",
  );
}

async function preflight(admin, adminUrl) {
  const { rows } = await admin.query(
    "SELECT current_database() AS db, current_setting('server_version_num')::int AS ver, " +
      "current_setting('port') AS port, (SELECT rolcreatedb OR rolsuper FROM pg_roles WHERE rolname = current_user) AS can_create",
  );
  const info = rows[0];
  if (!MAINTENANCE_DATABASES.has(info.db)) {
    throw new HarnessError(`Destino recusado: conectado em "${info.db}".`, "REFUSED_TARGET");
  }
  const expectedPort = adminUrl.port || "5432";
  if (String(info.port) !== String(expectedPort)) {
    throw new HarnessError(
      `Destino recusado: a porta informada (${expectedPort}) difere da porta do servidor (${info.port}).`,
      "REFUSED_TARGET",
    );
  }
  if (!info.can_create) {
    throw new HarnessError("O usuário administrativo não tem CREATEDB. " + PREPARE_HINT, "MISSING_PREREQUISITE");
  }
  const ext = await admin.query("SELECT name FROM pg_available_extensions WHERE name = ANY($1)", [
    REQUIRED_EXTENSIONS,
  ]);
  const available = new Set(ext.rows.map((row) => row.name));
  const missing = REQUIRED_EXTENSIONS.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new HarnessError(
      `Extensões ausentes no servidor de teste: ${missing.join(", ")}. As migrations exigem pgvector e pgcrypto. ` +
        PREPARE_HINT,
      "MISSING_PREREQUISITE",
    );
  }
  return info;
}

export async function createOwnedDatabase(admin, name, runId) {
  if (!DB_NAME_PATTERN.test(name)) throw new HarnessError(`Nome de banco de teste inválido: ${name}`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.query(`COMMENT ON DATABASE "${name}" IS '${MARKER_PREFIX}${runId}'`);
}

export async function dropOwnedDatabase(admin, name, runId) {
  if (!DB_NAME_PATTERN.test(name)) throw new HarnessError(`Recusado remover banco fora do padrão: ${name}`);
  const { rows } = await admin.query("SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = $1", [name]);
  if (rows.length === 0) return;
  if (rows[0].marker !== `${MARKER_PREFIX}${runId}`) {
    throw new HarnessError(`Recusado remover "${name}": marcador de propriedade não confere com esta execução.`, "REFUSED_TARGET");
  }
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}

/**
 * Cria bancos exclusivos da execução, chama fn(ctx) e SEMPRE tenta limpar.
 * Retorna o resultado de fn; se fn lançar, a exceção original é preservada
 * (falhas de limpeza ficam registradas em stderr e em ctx.cleanupErrors).
 */
export async function withDisposableDatabases(options, fn) {
  const { shadow = false, env = process.env, log = console.error } = options ?? {};
  const adminUrl = readAdminUrl(env);
  await waitForPostgres(adminUrl.toString());

  const runId = newRunId();
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const created = [];
  const ctx = { runId, adminUrl, cleanupErrors: [] };
  let result;
  let failure;
  try {
    ctx.serverInfo = await preflight(admin, adminUrl);
    const mainName = `vtest_${runId}`;
    await createOwnedDatabase(admin, mainName, runId);
    created.push(mainName);
    ctx.databaseName = mainName;
    ctx.databaseUrl = urlForDatabase(adminUrl, mainName);
    if (shadow) {
      const shadowName = `${mainName}_shadow`;
      await createOwnedDatabase(admin, shadowName, runId);
      created.push(shadowName);
      ctx.shadowName = shadowName;
      ctx.shadowUrl = urlForDatabase(adminUrl, shadowName);
    }
    result = await fn(ctx);
  } catch (error) {
    failure = error;
  } finally {
    for (const name of created.reverse()) {
      try {
        await dropOwnedDatabase(admin, name, runId);
      } catch (error) {
        ctx.cleanupErrors.push(`${name}: ${error.message}`);
        log(`[harness] falha ao limpar ${name}: ${error.message}`);
      }
    }
    await admin.end().catch(() => undefined);
  }
  if (failure) throw failure;
  if (ctx.cleanupErrors.length > 0) {
    throw new HarnessError(`Testes passaram, mas a limpeza falhou: ${ctx.cleanupErrors.join("; ")}`, "CLEANUP_FAILED");
  }
  return result;
}

export function prismaCliPath() {
  return require.resolve("prisma/build/index.js");
}

/** Executa o CLI do Prisma sem shell (evita npx/.cmd e quoting no Windows). */
export function runPrisma(args, { env, capture = false } = {}) {
  const result = spawnSync(process.execPath, [prismaCliPath(), ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function prismaEnv(ctx) {
  return { DATABASE_URL: ctx.databaseUrl, ...(ctx.shadowUrl ? { SHADOW_DATABASE_URL: ctx.shadowUrl } : {}) };
}

export function migrateDeploy(ctx) {
  const run = runPrisma(["migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    env: prismaEnv(ctx),
    capture: true,
  });
  if (run.status !== 0) {
    throw new HarnessError(`prisma migrate deploy falhou (exit ${run.status}):\n${run.stdout}\n${run.stderr}`, "MIGRATE_FAILED");
  }
  return run;
}

export function generatePrismaClient() {
  const run = runPrisma(["generate", "--schema", "prisma/schema.prisma"], { capture: true });
  if (run.status !== 0) throw new HarnessError(`prisma generate falhou:\n${run.stderr}`, "GENERATE_FAILED");
}

/** Padrão de execução de scripts de teste: código de saída fiel, mensagem sanitizada. */
export async function runCli(main) {
  try {
    await main();
    process.exitCode = 0;
  } catch (error) {
    const code = error instanceof HarnessError ? error.code : "TEST_FAILED";
    console.error(`[teste] FALHOU (${code}): ${error?.message ?? error}`);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 1);
}
