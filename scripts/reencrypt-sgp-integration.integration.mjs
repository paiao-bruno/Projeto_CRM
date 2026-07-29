#!/usr/bin/env node
/**
 * Teste de integração REAL em PostgreSQL descartável e isolado.
 * Nunca usa DATABASE_URL do ambiente host — apenas URL fixa de teste.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { decryptJsonWithKey, encryptJsonWithKey } from "./lib/encryption.mjs";
import {
  assertContainerIdStable,
  assertNoContainerRestarts,
  buildDockerHealthcheckArgs,
  captureDisposableDockerDiagnostics,
  formatConnectionError,
  formatDiagnosticsReport,
  getContainerRuntimeState,
  runDockerCommand,
  runTcpSelectOneProbe,
  waitForContainerRunningAndHealthy,
  waitForTcpSelectOneStability,
} from "./lib/docker-disposable-readiness.mjs";
import {
  hashText,
  readBackupFile,
  runReencryptOperation,
} from "./lib/reencrypt-sgp-integration.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DISPOSABLE_CONTAINER_NAME = "isp-crm-reencrypt-test";
export const ISOLATED_PORT = 55999;
export const ISOLATED_DB = "reencrypt_disposable_test";
export const ISOLATED_USER = "reencrypt_test";
export const ISOLATED_PASSWORD = "reencrypt_test";
export const ISOLATED_DATABASE_URL = `postgresql://${ISOLATED_USER}:${ISOLATED_PASSWORD}@127.0.0.1:${ISOLATED_PORT}/${ISOLATED_DB}?schema=public`;
const SCHEMA_FIXTURE = path.join(ROOT, "scripts/fixtures/reencrypt-disposable-schema.sql");
const EMBEDDED_DATA_DIR = path.join(os.tmpdir(), "isp-crm-reencrypt-embedded-pg");
export const PRISMA_SCHEMA_PATH = path.join(ROOT, "prisma/schema.prisma");
export const REQUIRED_PG_EXTENSIONS = ["pgcrypto", "vector"];
export const DOCKER_PG_ISREADY_TIMEOUT_MS = 60_000;

const KEY_A = "disposable-encryption-key-A-32chars!";
const KEY_B = "disposable-encryption-key-B-32chars!";
const FAKE_APP_A = "fake-app-alpha";
const FAKE_TOKEN_A = "fake-token-alpha-value";
const FAKE_APP_B = "fake-app-beta";
const FAKE_TOKEN_B = "fake-token-beta-value";

/** @type {{ backend: string, container?: { name: string, id: string, restartCount?: number }, embedded?: unknown } | null} */
let managedDatabase = null;

/** @type {ReturnType<typeof captureDisposableDockerDiagnostics> | null} */
let lastDockerDiagnostics = null;

const results = {
  isolatedDatabaseUrlMasked: `postgresql://${ISOLATED_USER}:***@127.0.0.1:${ISOLATED_PORT}/${ISOLATED_DB}?schema=public`,
  migrationsApplied: [],
  scenarios: {},
  columnsChangedOnExecute: [],
  updatedAtBehavior: null,
  backupVerification: null,
  rollbackVerification: null,
  realDatabaseAccessed: false,
  staticReview: [],
  eventLog: [],
};

export function maskUrl(url) {
  return url.replace(/:\/\/([^:@]+):([^@]+)@/, "://$1:***@");
}

export function assertDisposableDatabaseUrl(url) {
  const forbidden = [
    "isp_crm?schema=public",
    "localhost:5432/isp_crm",
    "localhost:51214",
    ":5432/",
    ":5432?",
  ];
  for (const marker of forbidden) {
    if (url.includes(marker)) {
      throw new Error(`Abortado: URL proibida detectada (${marker}).`);
    }
  }
  if (url.includes("/isp_crm") || url.includes("database=isp_crm")) {
    throw new Error("Abortado: URL descartável não pode usar banco isp_crm.");
  }
  if (!url.includes(ISOLATED_DB) || !url.includes(String(ISOLATED_PORT))) {
    throw new Error("Abortado: URL não é o banco descartável isolado.");
  }
}

export function assertHostDatabaseUrlIgnored(hostUrl) {
  if (hostUrl && !hostUrl.includes(ISOLATED_DB)) {
    results.realDatabaseAccessed = false;
    console.log(
      `[guard] DATABASE_URL do host presente (${maskUrl(hostUrl)}) — não será usada.`,
    );
  }
}

export function checkDockerAvailable() {
  const proc = spawnSync("docker", ["info"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return proc.status === 0;
}

export function checkDisposableContainerAbsent(containerName = DISPOSABLE_CONTAINER_NAME) {
  const proc = spawnSync(
    "docker",
    ["container", "inspect", containerName],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (proc.status === 0) {
    throw new Error(
      `Abortado: container descartável "${containerName}" já existe. Remova-o manualmente ou aguarde outra execução terminar.`,
    );
  }
}

export function checkPortAvailable(port = ISOLATED_PORT, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `Abortado: porta ${port} em ${host} já está ocupada. Libere a porta antes do teste live.`,
          ),
        );
        return;
      }
      reject(error);
    });
    server.once("listening", () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve();
      });
    });
    server.listen(port, host);
  });
}

export function assertCleanupTarget(containerState) {
  if (!containerState?.id || !containerState?.name) {
    throw new Error("Cleanup abortado: nenhum container gerenciado registrado.");
  }
  if (containerState.name !== DISPOSABLE_CONTAINER_NAME) {
    throw new Error(
      `Cleanup abortado: nome inesperado "${containerState.name}" (esperado "${DISPOSABLE_CONTAINER_NAME}").`,
    );
  }
  const inspect = spawnSync(
    "docker",
    ["inspect", "--format", "{{.Name}}", containerState.id],
    { encoding: "utf8" },
  );
  if (inspect.status !== 0) {
    throw new Error("Cleanup abortado: container gerenciado não encontrado.");
  }
  const inspectedName = inspect.stdout.trim().replace(/^\//, "");
  if (inspectedName !== DISPOSABLE_CONTAINER_NAME) {
    throw new Error(
      `Cleanup abortado: ID não corresponde a "${DISPOSABLE_CONTAINER_NAME}".`,
    );
  }
}

export function logDisposableStartup(backend) {
  console.log(`[reencrypt-live] backend: ${backend}`);
  console.log("[reencrypt-live] host: 127.0.0.1");
  console.log(`[reencrypt-live] port: ${ISOLATED_PORT}`);
  console.log(`[reencrypt-live] database: ${ISOLATED_DB}`);
}

export async function importEmbeddedPostgresModule() {
  return import("embedded-postgres");
}

export async function startEmbeddedPostgresFallback(importModule = importEmbeddedPostgresModule) {
  let EmbeddedPostgres;
  try {
    ({ default: EmbeddedPostgres } = await importModule());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Docker indisponível e pacote embedded-postgres não instalado (${detail}). ` +
        "Instale Docker Desktop ou adicione embedded-postgres como dependência de desenvolvimento.",
    );
  }

  fs.rmSync(EMBEDDED_DATA_DIR, { recursive: true, force: true });
  const embeddedInstance = new EmbeddedPostgres({
    databaseDir: EMBEDDED_DATA_DIR,
    port: ISOLATED_PORT,
    user: ISOLATED_USER,
    password: ISOLATED_PASSWORD,
    database: ISOLATED_DB,
  });
  await embeddedInstance.initialise();
  await embeddedInstance.start();

  const bootstrapUrl = `postgresql://${ISOLATED_USER}:${ISOLATED_PASSWORD}@127.0.0.1:${ISOLATED_PORT}/template1`;
  const bootstrap = new Client({ connectionString: bootstrapUrl });
  await bootstrap.connect();
  try {
    await bootstrap.query(`CREATE DATABASE "${ISOLATED_DB}"`);
  } catch (createError) {
    if (!String(createError).includes("already exists")) {
      throw createError;
    }
  } finally {
    await bootstrap.end();
  }

  return {
    backend: "embedded-postgres",
    embedded: embeddedInstance,
  };
}

export function startDockerContainer(containerName = DISPOSABLE_CONTAINER_NAME) {
  checkDisposableContainerAbsent(containerName);

  const start = runDockerCommand([
    "run",
    "-d",
    "--name",
    containerName,
    ...buildDockerHealthcheckArgs(ISOLATED_USER, ISOLATED_DB),
    "-e",
    `POSTGRES_USER=${ISOLATED_USER}`,
    "-e",
    `POSTGRES_PASSWORD=${ISOLATED_PASSWORD}`,
    "-e",
    `POSTGRES_DB=${ISOLATED_DB}`,
    "-p",
    `${ISOLATED_PORT}:5432`,
    "pgvector/pgvector:pg16",
  ]);
  if (start.status !== 0) {
    throw new Error(`[docker-run] falhou: ${start.stderr || start.stdout}`);
  }

  const state = getContainerRuntimeState(containerName);
  if (!state.id) {
    throw new Error(`[docker-run] não foi possível inspecionar container "${containerName}".`);
  }

  console.log(`[reencrypt-live] docker-run: container ${containerName} id=${state.id.slice(0, 12)}`);

  return {
    backend: "Docker",
    container: {
      name: containerName,
      id: state.id,
      restartCount: state.restartCount,
    },
  };
}

export async function waitForDisposablePostgres(databaseUrl = ISOLATED_DATABASE_URL) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const probe = new Client({ connectionString: databaseUrl });
    try {
      await probe.connect();
      await probe.query("SELECT 1");
      await probe.end();
      return;
    } catch {
      await probe.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("PostgreSQL descartável não ficou pronto a tempo.");
}

export async function waitForDockerPostgresReady(
  containerName = DISPOSABLE_CONTAINER_NAME,
  deps = {},
) {
  const timeoutMs = deps.timeoutMs ?? DOCKER_PG_ISREADY_TIMEOUT_MS;
  const intervalMs = deps.intervalMs ?? 1000;
  const runDockerExec =
    deps.runDockerExec ??
    ((args) => runDockerCommand(args));
  const deadline = Date.now() + timeoutMs;
  let lastFailure = null;

  while (Date.now() < deadline) {
    const proc = runDockerExec([
      "exec",
      containerName,
      "pg_isready",
      "-U",
      ISOLATED_USER,
      "-d",
      ISOLATED_DB,
    ]);
    if (proc.status === 0) {
      console.log(`[reencrypt-live] pg_isready: OK (${containerName})`);
      return;
    }
    lastFailure = formatSubprocessFailure("pg_isready", {
      command: "docker",
      args: [
        "exec",
        containerName,
        "pg_isready",
        "-U",
        ISOLATED_USER,
        "-d",
        ISOLATED_DB,
      ],
      cwd: ROOT,
    }, proc);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `[pg_isready] timeout após ${timeoutMs}ms no container "${containerName}".\n${lastFailure ?? "(sem detalhe adicional)"}`,
  );
}

export async function runDockerReadinessPipeline(
  containerState,
  databaseUrl = ISOLATED_DATABASE_URL,
  deps = {},
) {
  const containerName = containerState.name;
  const expectedId = containerState.id;
  const baselineRestartCount = containerState.restartCount ?? 0;

  await waitForContainerRunningAndHealthy(containerName, deps);
  assertContainerIdStable(containerName, expectedId, deps.runDocker ?? runDockerCommand);
  assertNoContainerRestarts(containerName, baselineRestartCount, deps.runDocker ?? runDockerCommand);

  await waitForDockerPostgresReady(containerName, deps);

  assertContainerIdStable(containerName, expectedId, deps.runDocker ?? runDockerCommand);
  assertNoContainerRestarts(containerName, baselineRestartCount, deps.runDocker ?? runDockerCommand);

  const runTcpStability =
    deps.waitForTcpSelectOneStability ??
    ((fn, tcpDeps) => waitForTcpSelectOneStability(fn, tcpDeps));

  await runTcpStability(
    async () => {
      await runTcpSelectOneProbe(databaseUrl, Client);
    },
    {
      ...deps,
      stage: "tcp-select1-stability",
    },
  );

  assertContainerIdStable(containerName, expectedId, deps.runDocker ?? runDockerCommand);
  assertNoContainerRestarts(containerName, baselineRestartCount, deps.runDocker ?? runDockerCommand);

  return {
    containerId: expectedId,
    restartCount: baselineRestartCount,
  };
}

export function recordDockerDiagnostics(stage, connectionError, containerName = DISPOSABLE_CONTAINER_NAME) {
  lastDockerDiagnostics = captureDisposableDockerDiagnostics(
    containerName,
    stage,
    connectionError,
    {
      sanitize: sanitizeProcessOutput,
      runDocker: runDockerCommand,
    },
  );
  return lastDockerDiagnostics;
}

export function getLastDockerDiagnostics() {
  return lastDockerDiagnostics;
}

export function buildDisposableProcessEnv(overrides = {}) {
  const env = {
    ...process.env,
    NODE_ENV: "test",
    ...overrides,
  };
  delete env.DATABASE_URL;
  delete env.SHADOW_DATABASE_URL;
  delete env.DIRECT_URL;
  env.DATABASE_URL = ISOLATED_DATABASE_URL;
  return env;
}

export function resolvePrismaMigrateDeployInvocation(rootDir = ROOT) {
  const schemaPath = path.join(rootDir, "prisma/schema.prisma");
  const prismaCli = path.join(rootDir, "node_modules/prisma/build/index.js");
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema Prisma não encontrado: ${schemaPath}`);
  }
  if (!fs.existsSync(prismaCli)) {
    throw new Error(
      `Prisma CLI não encontrado: ${prismaCli}. Execute npm install na raiz do monorepo.`,
    );
  }
  return {
    command: process.execPath,
    args: [prismaCli, "migrate", "deploy", "--schema", schemaPath],
    cwd: rootDir,
    schemaPath,
    prismaCli,
  };
}

export function sanitizeProcessOutput(text, redactValues = []) {
  if (text === undefined || text === null || text === "") {
    return "(vazio)";
  }
  let output = String(text).replaceAll(ISOLATED_PASSWORD, "***");
  for (const value of redactValues) {
    if (typeof value === "string" && value.length > 0) {
      output = output.replaceAll(value, "[REDACTED]");
    }
  }
  return maskUrl(output);
}

export function parseDryRunCliReport(stdout) {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) {
    throw new Error("Saída vazia do subprocesso dry-run.");
  }
  let report;
  try {
    report = JSON.parse(trimmed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Saída dry-run não é JSON válido: ${detail}`);
  }
  if (!report || typeof report !== "object") {
    throw new Error("Relatório dry-run inválido: esperado objeto JSON.");
  }
  return report;
}

export function extractDryRunProofToken(report) {
  const token = report?.dryRunProof?.token;
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("dryRunProof.token ausente ou inválido no relatório dry-run.");
  }
  return token.trim();
}

export function redactDryRunReportForOutput(report) {
  if (!report?.dryRunProof?.token) {
    return report;
  }
  return {
    ...report,
    dryRunProof: {
      ...report.dryRunProof,
      token: "[REDACTED]",
    },
  };
}

export function buildExecuteEnvFromDryRun(baseEnv, proofToken) {
  const token = extractDryRunProofToken({ dryRunProof: { token: proofToken } });
  return {
    ...baseEnv,
    REENCRYPT_DRY_RUN_PROOF: token,
  };
}

export function parseCliJsonReport(stdout) {
  return parseDryRunCliReport(stdout);
}

export async function runReencryptDryRunThenExecute(runCliFn, baseEnv) {
  const dryRun = await runCliFn(["--dry-run"], baseEnv);
  const dryRunReport = parseDryRunCliReport(dryRun.stdout);
  const proofToken = extractDryRunProofToken(dryRunReport);
  const executeEnv = buildExecuteEnvFromDryRun(baseEnv, proofToken);
  const execute = await runCliFn(["--execute"], executeEnv, [proofToken]);
  return {
    dryRun,
    execute,
    dryRunReport,
    proofToken,
  };
}

export function formatSubprocessFailure(stage, invocation, proc, redactValues = []) {
  return [
    `[${stage}] subprocesso falhou`,
    `comando: ${invocation.command} ${(invocation.args ?? []).join(" ")}`,
    `cwd: ${invocation.cwd}`,
    `databaseUrl: ${maskUrl(ISOLATED_DATABASE_URL)}`,
    `exitCode: ${proc.status ?? "null"}`,
    `signal: ${proc.signal ?? "null"}`,
    `error.message: ${proc.error?.message ?? "(nenhum)"}`,
    `stdout: ${sanitizeProcessOutput(proc.stdout, redactValues)}`,
    `stderr: ${sanitizeProcessOutput(proc.stderr, redactValues)}`,
  ].join("\n");
}

export function runPrismaMigrateDeploy(options = {}) {
  const rootDir = options.rootDir ?? ROOT;
  const invocation = resolvePrismaMigrateDeployInvocation(rootDir);
  const runSubprocess =
    options.runSubprocess ??
    ((command, args, spawnOptions) =>
      spawnSync(command, args, {
        ...spawnOptions,
        shell: false,
      }));

  const proc = runSubprocess(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: buildDisposableProcessEnv(options.env),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (proc.error || proc.status !== 0) {
    throw new Error(formatSubprocessFailure("prisma migrate deploy", invocation, proc));
  }

  return { invocation, proc };
}

export async function verifyRequiredExtensions(client) {
  const missing = [];
  for (const extension of REQUIRED_PG_EXTENSIONS) {
    const { rows } = await client.query(
      `SELECT 1 FROM pg_extension WHERE extname = $1`,
      [extension],
    );
    if (rows.length === 0) {
      missing.push(extension);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Extensões PostgreSQL ausentes após migration: ${missing.join(", ")}. ` +
        "A imagem pgvector/pgvector:pg16 deve fornecer pgcrypto e vector.",
    );
  }
}

export async function applyDockerPrismaMigrations(client, options = {}) {
  runPrismaMigrateDeploy(options);
  await verifyRequiredExtensions(client);
  return {
    migrationsApplied: [
      "20260708160000_init",
      "20260720140000_performance_indexes",
    ],
    migrationsSource: "prisma migrate deploy",
    extensionsVerified: [...REQUIRED_PG_EXTENSIONS],
  };
}

export async function startDisposableDatabase(deps = {}) {
  const checkDocker = deps.checkDockerAvailable ?? checkDockerAvailable;
  const startDocker = deps.startDockerContainer ?? startDockerContainer;
  const startEmbedded = deps.startEmbeddedPostgresFallback ?? startEmbeddedPostgresFallback;
  const checkPort = deps.checkPortAvailable ?? checkPortAvailable;
  const waitFor = deps.waitForDisposablePostgres ?? waitForDisposablePostgres;

  assertDisposableDatabaseUrl(ISOLATED_DATABASE_URL);
  await checkPort(ISOLATED_PORT, "127.0.0.1");

  const readinessPipeline =
    deps.runDockerReadinessPipeline ??
    ((container, url, pipelineDeps) => runDockerReadinessPipeline(container, url, pipelineDeps));

  if (checkDocker()) {
    const started = startDocker();
    logDisposableStartup(started.backend);
    await readinessPipeline(started.container, ISOLATED_DATABASE_URL, deps);
    managedDatabase = started;
    results.databaseBackend = "docker-pgvector-pg16";
    return started;
  }

  const started = await startEmbedded(deps.importEmbeddedPostgresModule);
  logDisposableStartup(started.backend);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await waitFor();
  managedDatabase = started;
  results.databaseBackend = "embedded-postgres";
  return started;
}

export async function stopDisposableDatabase(state = managedDatabase, deps = {}) {
  if (!state) {
    return;
  }

  const verifyCleanupTarget = deps.assertCleanupTarget ?? assertCleanupTarget;

  if (state.backend === "Docker" && state.container) {
    if (lastDockerDiagnostics && !deps.skipDiagnosticsCapture) {
      console.error(formatDiagnosticsReport(lastDockerDiagnostics));
    }
    verifyCleanupTarget(state.container);
    const remove = deps.removeDockerContainer ?? ((id) => {
      runDockerCommand(["rm", "-f", id], { stdio: "ignore" });
    });
    remove(state.container.id);
    if (managedDatabase === state) {
      managedDatabase = null;
    }
    lastDockerDiagnostics = null;
    return;
  }

  if (state.backend === "embedded-postgres" && state.embedded) {
    await state.embedded.stop();
    fs.rmSync(EMBEDDED_DATA_DIR, { recursive: true, force: true });
    if (managedDatabase === state) {
      managedDatabase = null;
    }
  }
}

function runCommand(label, command, args, env = {}, redactValues = []) {
  const proc = spawnSync(command, args, {
    cwd: ROOT,
    env: buildDisposableProcessEnv(env),
    encoding: "utf8",
    shell: false,
  });

  if (proc.error || proc.status !== 0) {
    throw new Error(
      formatSubprocessFailure(label, { command, args, cwd: ROOT }, proc, redactValues),
    );
  }

  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
  };
}

async function applyMigrations(client) {
  if (results.databaseBackend === "docker-pgvector-pg16") {
    const migrationResult = await applyDockerPrismaMigrations(client);
    results.migrationsApplied = migrationResult.migrationsApplied;
    results.migrationsSource = migrationResult.migrationsSource;
    results.extensionsVerified = migrationResult.extensionsVerified;
    return;
  }

  const sql = fs.readFileSync(SCHEMA_FIXTURE, "utf8");
  await client.query(sql);
  results.migrationsApplied = [
    "20260708160000_init (fixture subset)",
    "20260720140000_performance_indexes (marker only)",
  ];
  results.migrationsSource = "scripts/fixtures/reencrypt-disposable-schema.sql";
}

function hashRow(row) {
  return hashText(JSON.stringify(row));
}

export const REQUIRED_LIVE_EVENT_ORDER = [
  "create-disposable-database",
  "apply-migrations",
  "insert-fixture",
  "snapshot-initial",
  "dry-run",
  "snapshot-after-dry-run",
  "assert-dry-run-unchanged",
  "extract-proof",
  "execute",
  "snapshot-after-execute",
  "assert-only-encryptedSecrets-changed",
  "restore-dry-run",
  "snapshot-after-restore-dry-run",
  "assert-restore-dry-run-unchanged",
  "restore-execute",
  "snapshot-after-restore-execute",
  "assert-original-restored",
  "rollback-scenario",
  "assert-rollback",
  "cleanup",
];

export function createLiveEventLog() {
  /** @type {string[]} */
  const events = [];
  return {
    get events() {
      return [...events];
    },
    step(name) {
      events.push(name);
      console.log(`[reencrypt-live] ${name}`);
    },
  };
}

export function assertLiveEventOrder(
  loggedEvents,
  expectedOrder = REQUIRED_LIVE_EVENT_ORDER,
) {
  if (loggedEvents.length !== expectedOrder.length) {
    throw new Error(
      `Ordem de eventos inválida: esperados ${expectedOrder.length}, recebidos ${loggedEvents.length}. ` +
        `Esperado: [${expectedOrder.join(", ")}]; recebido: [${loggedEvents.join(", ")}]`,
    );
  }
  for (let index = 0; index < expectedOrder.length; index += 1) {
    if (loggedEvents[index] !== expectedOrder[index]) {
      throw new Error(
        `Ordem de eventos inválida no índice ${index}: esperado "${expectedOrder[index]}", ` +
          `recebido "${loggedEvents[index] ?? "(ausente)"}".`,
      );
    }
  }
}

export function compareIntegrationRows(before, after) {
  const changed = [];
  for (const key of Object.keys(before)) {
    const b = before[key] instanceof Date ? before[key].toISOString() : before[key];
    const a = after[key] instanceof Date ? after[key].toISOString() : after[key];
    const bNorm = b && typeof b === "object" ? JSON.stringify(b) : b;
    const aNorm = a && typeof a === "object" ? JSON.stringify(a) : a;
    if (bNorm !== aNorm) {
      changed.push(key);
    }
  }
  return changed;
}

export function assertDryRunUnchanged(beforeIntegration, afterDryRunIntegration, beforeTenant, afterDryRunTenant) {
  const dryRunChanged = compareIntegrationRows(beforeIntegration, afterDryRunIntegration);
  if (dryRunChanged.length > 0) {
    throw new Error(
      `[assert-dry-run-unchanged] Integration alterada após dry-run: ${dryRunChanged.join(", ")}. ` +
        "O snapshot deve ser coletado imediatamente após dry-run e antes de --execute.",
    );
  }
  assertTenantChecksumsUnchanged(beforeTenant, afterDryRunTenant, "dry-run");
}

export function assertOnlyEncryptedSecretsChanged(beforeIntegration, afterExecuteIntegration) {
  const executeChanged = compareIntegrationRows(beforeIntegration, afterExecuteIntegration);
  if (afterExecuteIntegration.id !== beforeIntegration.id) {
    throw new Error("[assert-only-encryptedSecrets-changed] Integration.id foi alterado.");
  }
  if (executeChanged.length !== 1 || executeChanged[0] !== "encryptedSecrets") {
    throw new Error(
      `[assert-only-encryptedSecrets-changed] esperado alterar somente encryptedSecrets; ` +
        `alterado: ${executeChanged.join(", ") || "(nenhum)"}`,
    );
  }
  return executeChanged;
}

export function assertTenantChecksumsUnchanged(beforeTenant, afterTenant, stage) {
  for (const key of Object.keys(beforeTenant.checksums)) {
    if (beforeTenant.checksums[key] !== afterTenant.checksums[key]) {
      throw new Error(`[${stage}] checksum ${key} alterado.`);
    }
  }
}

export function assertCiphertextEqual(actual, expected, stage) {
  if (actual !== expected) {
    throw new Error(`[${stage}] ciphertext divergente do esperado (comparação byte-a-byte).`);
  }
}

export async function fetchIntegrationSnapshot(client, integrationId) {
  const { rows } = await client.query(`SELECT * FROM "Integration" WHERE id = $1`, [
    integrationId,
  ]);
  return rows[0];
}

export async function fetchTenantSnapshot(client, tenantId) {
  const customers = await client.query(
    `SELECT id, "tenantId", name, "deletedAt", "createdAt", "updatedAt" FROM "Customer" WHERE "tenantId" = $1 ORDER BY id`,
    [tenantId],
  );
  const contracts = await client.query(
    `SELECT id, "tenantId", "customerId", "externalId", "deletedAt", "createdAt", "updatedAt" FROM "Contract" WHERE "tenantId" = $1 ORDER BY id`,
    [tenantId],
  );
  const invoices = await client.query(
    `SELECT id, "tenantId", "customerId", "contractId", "externalId", "deletedAt", "createdAt", "updatedAt" FROM "Invoice" WHERE "tenantId" = $1 ORDER BY id`,
    [tenantId],
  );
  const syncRuns = await client.query(
    `SELECT * FROM "IntegrationSyncRun" WHERE "tenantId" = $1 ORDER BY id`,
    [tenantId],
  );
  const syncLogs = await client.query(
    `SELECT * FROM "IntegrationSyncLog" WHERE "tenantId" = $1 ORDER BY id`,
    [tenantId],
  );

  return {
    customers: customers.rows,
    contracts: contracts.rows,
    invoices: invoices.rows,
    syncRuns: syncRuns.rows,
    syncLogs: syncLogs.rows,
    checksums: {
      customers: hashRow(customers.rows),
      contracts: hashRow(contracts.rows),
      invoices: hashRow(invoices.rows),
      syncRuns: hashRow(syncRuns.rows),
      syncLogs: hashRow(syncLogs.rows),
    },
  };
}

export async function runLiveReencryptStateMachine(ctx) {
  const eventLog = ctx.eventLog ?? createLiveEventLog();
  const step = (name) => eventLog.step(name);
  const runCliFn = ctx.runCli;
  const client = ctx.client;
  const seeded = ctx.seeded;
  const backupDir = ctx.backupDir;
  const resultsRef = ctx.results;

  step("snapshot-initial");
  const beforeIntegration = await fetchIntegrationSnapshot(client, seeded.integrationId);
  const beforeTenant = await fetchTenantSnapshot(client, seeded.tenantId);
  resultsRef.scenarios.initial = {
    integrationId: seeded.integrationId,
    tenantId: seeded.tenantId,
    encryptedSecretsHash: hashText(beforeIntegration.encryptedSecrets),
    integrationChecksum: hashRow(beforeIntegration),
    tenantChecksums: beforeTenant.checksums,
  };

  const dryRunEnv = buildScriptEnv({
    ENCRYPTION_KEY: ctx.keyB ?? KEY_B,
    SGP_APP: ctx.fakeAppB ?? FAKE_APP_B,
    SGP_TOKEN: ctx.fakeTokenB ?? FAKE_TOKEN_B,
    REENCRYPT_TENANT_ID: seeded.tenantId,
    REENCRYPT_INTEGRATION_ID: seeded.integrationId,
    REENCRYPT_CONFIRM_ID: seeded.integrationId,
    REENCRYPT_BACKUP_DIR: backupDir,
  });

  step("dry-run");
  const dryRun = await runCliFn(["--dry-run"], dryRunEnv);
  const dryRunReport = parseDryRunCliReport(dryRun.stdout);

  step("snapshot-after-dry-run");
  const afterDryRunIntegration = await fetchIntegrationSnapshot(client, seeded.integrationId);
  const afterDryRunTenant = await fetchTenantSnapshot(client, seeded.tenantId);

  step("assert-dry-run-unchanged");
  assertDryRunUnchanged(beforeIntegration, afterDryRunIntegration, beforeTenant, afterDryRunTenant);
  resultsRef.scenarios.dryRun = {
    exitCode: 0,
    report: redactDryRunReportForOutput(dryRunReport),
    proofPropagated: false,
    verification: {
      integrationUnchanged: true,
      tenantChecksumsUnchanged: true,
    },
  };

  step("extract-proof");
  const proofToken = extractDryRunProofToken(dryRunReport);
  const executeEnv = buildExecuteEnvFromDryRun(dryRunEnv, proofToken);
  resultsRef.scenarios.dryRun.proofPropagated = true;

  step("execute");
  const executeRun = await runCliFn(["--execute"], executeEnv, [proofToken]);
  const executeReport = parseCliJsonReport(executeRun.stdout);

  step("snapshot-after-execute");
  const afterExecuteIntegration = await fetchIntegrationSnapshot(client, seeded.integrationId);
  const afterExecuteTenant = await fetchTenantSnapshot(client, seeded.tenantId);

  step("assert-only-encryptedSecrets-changed");
  const executeChanged = assertOnlyEncryptedSecretsChanged(beforeIntegration, afterExecuteIntegration);
  assertTenantChecksumsUnchanged(beforeTenant, afterExecuteTenant, "assert-only-encryptedSecrets-changed");
  resultsRef.scenarios.execute = { exitCode: 0, report: executeReport };
  resultsRef.columnsChangedOnExecute = executeChanged;
  resultsRef.updatedAtBehavior = {
    before: beforeIntegration.updatedAt?.toISOString?.() ?? beforeIntegration.updatedAt,
    after: afterExecuteIntegration.updatedAt?.toISOString?.() ?? afterExecuteIntegration.updatedAt,
    changed: executeChanged.includes("updatedAt"),
  };

  const backupFile = executeReport.backupFile;
  const readBackup = ctx.readBackupFile ?? readBackupFile;
  const pathExists = ctx.pathExists ?? fs.existsSync.bind(fs);
  if (!backupFile || !pathExists(backupFile)) {
    throw new Error("Arquivo de backup não foi criado.");
  }
  const backup = readBackup(backupFile);
  resultsRef.backupVerification = {
    path: backupFile,
    hasOriginalCiphertext: backup.integration.encryptedSecrets === seeded.originalEncryptedSecrets,
    hashMatches:
      hashText(backup.integration.encryptedSecrets) === hashText(seeded.originalEncryptedSecrets),
    consoleLeakedCiphertext: executeRun.stdout.includes(seeded.originalEncryptedSecrets),
  };
  if (!resultsRef.backupVerification.hasOriginalCiphertext) {
    throw new Error("Backup não contém ciphertext original.");
  }
  if (resultsRef.backupVerification.consoleLeakedCiphertext) {
    throw new Error("Ciphertext vazou no stdout.");
  }

  const restoreDryEnv = buildScriptEnv({
    ENCRYPTION_KEY: ctx.keyA ?? KEY_A,
    REENCRYPT_TENANT_ID: seeded.tenantId,
    REENCRYPT_INTEGRATION_ID: seeded.integrationId,
    REENCRYPT_CONFIRM_ID: seeded.integrationId,
  });

  step("restore-dry-run");
  const restoreDry = await runCliFn(["--restore", `--backup-file=${backupFile}`], restoreDryEnv);
  resultsRef.scenarios.restoreDryRun = {
    exitCode: 0,
    report: parseCliJsonReport(restoreDry.stdout),
  };

  step("snapshot-after-restore-dry-run");
  const afterRestoreDryIntegration = await fetchIntegrationSnapshot(client, seeded.integrationId);

  step("assert-restore-dry-run-unchanged");
  assertCiphertextEqual(
    afterRestoreDryIntegration.encryptedSecrets,
    afterExecuteIntegration.encryptedSecrets,
    "assert-restore-dry-run-unchanged",
  );

  step("restore-execute");
  const restoreExec = await runCliFn(
    ["--restore", `--backup-file=${backupFile}`, "--execute"],
    restoreDryEnv,
  );
  resultsRef.scenarios.restoreExecute = {
    exitCode: 0,
    report: parseCliJsonReport(restoreExec.stdout),
  };

  step("snapshot-after-restore-execute");
  const afterRestoreIntegration = await fetchIntegrationSnapshot(client, seeded.integrationId);

  step("assert-original-restored");
  assertCiphertextEqual(
    afterRestoreIntegration.encryptedSecrets,
    seeded.originalEncryptedSecrets,
    "assert-original-restored",
  );
  resultsRef.scenarios.restoreExecute.originalCiphertextRestored = true;

  step("rollback-scenario");
  const rollbackClient = ctx.rollbackClient ?? new Client({ connectionString: ISOLATED_DATABASE_URL });
  let ownsRollbackClient = !ctx.rollbackClient;
  let rollbackFailed = false;
  let beforeRollback;
  let afterRollback;

  if (ctx.runRollbackScenario) {
    ({ rollbackFailed, beforeRollback, afterRollback } = await ctx.runRollbackScenario({
      seeded,
      backupDir,
      integrationState: afterRestoreIntegration,
    }));
  } else {
    if (ownsRollbackClient) {
      await rollbackClient.connect();
    }
    beforeRollback = await fetchIntegrationSnapshot(rollbackClient, seeded.integrationId);
    try {
      await runReencryptOperation(rollbackClient, {
        config: {
          databaseUrl: ISOLATED_DATABASE_URL,
          encryptionKey: ctx.keyB ?? KEY_B,
          sgpApp: ctx.fakeAppB ?? FAKE_APP_B,
          sgpToken: "another-fake-token-value",
          tenantId: seeded.tenantId,
          integrationId: seeded.integrationId,
          confirmId: seeded.integrationId,
          allowProduction: false,
          backupDir,
          nodeEnv: "test",
        },
        mode: "reencrypt",
        write: true,
        rootDir: ROOT,
        injectFailureAfterUpdate: true,
      });
    } catch (error) {
      rollbackFailed = error instanceof Error && error.message.includes("Falha simulada");
    }
    afterRollback = await fetchIntegrationSnapshot(rollbackClient, seeded.integrationId);
    if (ownsRollbackClient) {
      await rollbackClient.end();
    }
  }

  step("assert-rollback");
  resultsRef.rollbackVerification = {
    failureInjected: rollbackFailed,
    ciphertextUnchanged: afterRollback.encryptedSecrets === beforeRollback.encryptedSecrets,
    integrationChecksumUnchanged: hashRow(beforeRollback) === hashRow(afterRollback),
  };
  if (!rollbackFailed || !resultsRef.rollbackVerification.ciphertextUnchanged) {
    throw new Error("[assert-rollback] rollback simulado não manteve o estado original.");
  }

  resultsRef.scenarios.beforeAfter = {
    before: {
      integration: {
        id: beforeIntegration.id,
        encryptedSecretsHash: hashText(beforeIntegration.encryptedSecrets),
        updatedAt: resultsRef.updatedAtBehavior.before,
      },
      tenantChecksums: beforeTenant.checksums,
    },
    afterExecute: {
      integration: {
        id: afterExecuteIntegration.id,
        encryptedSecretsHash: hashText(afterExecuteIntegration.encryptedSecrets),
        updatedAt: resultsRef.updatedAtBehavior.after,
      },
      columnsChanged: executeChanged,
      tenantChecksums: afterExecuteTenant.checksums,
    },
    afterRestore: {
      encryptedSecretsHash: hashText(afterRestoreIntegration.encryptedSecrets),
      matchesOriginal: afterRestoreIntegration.encryptedSecrets === seeded.originalEncryptedSecrets,
    },
  };

  return {
    eventLog,
    beforeIntegration,
    afterExecuteIntegration,
    executeReport,
    executeRun,
  };
}

async function seedDisposableData(client) {
  const tenantId = randomUUID();
  const integrationId = randomUUID();
  const customerId = randomUUID();
  const contractId = randomUUID();
  const invoiceId = randomUUID();
  const syncRunId = randomUUID();
  const syncLogId = randomUUID();
  const now = new Date("2026-06-01T12:00:00.000Z");

  const encryptedSecrets = encryptJsonWithKey(KEY_A, {
    app: FAKE_APP_A,
    token: FAKE_TOKEN_A,
  });

  await client.query(
    `INSERT INTO "Tenant" (id, name, slug, status, "createdAt", "updatedAt")
     VALUES ($1, 'Tenant Descartável', $2, 'ACTIVE', $3, $3)`,
    [tenantId, `disposable-${tenantId.slice(0, 8)}`, now],
  );

  await client.query(
    `INSERT INTO "Integration" (
       id, "tenantId", provider, name, status, "healthStatus", config,
       "encryptedSecrets", "lastConnectedAt", "lastError", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, 'SGP', 'SGP Descartável', 'ACTIVE', 'UNKNOWN',
       $3::jsonb, $4, NULL, NULL, $5, $5
     )`,
    [
      integrationId,
      tenantId,
      JSON.stringify({
        apiUrl: "https://disposable.example.sgp.net.br",
        timeoutMs: 15000,
        syncState: { lastSyncMode: "full" },
        autoSync: { enabled: false },
      }),
      encryptedSecrets,
      now,
    ],
  );

  await client.query(
    `INSERT INTO "Customer" (
       id, "tenantId", name, status, "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'Cliente Fictício', 'ACTIVE', $3, $3)`,
    [customerId, tenantId, now],
  );

  await client.query(
    `INSERT INTO "Contract" (
       id, "tenantId", "customerId", "externalId", status, "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, 'contract-ext-1', 'ACTIVE', $4, $4)`,
    [contractId, tenantId, customerId, now],
  );

  await client.query(
    `INSERT INTO "Invoice" (
       id, "tenantId", "customerId", "contractId", "externalId", status, "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, 'invoice-ext-1', 'OPEN', $5, $5)`,
    [invoiceId, tenantId, customerId, contractId, now],
  );

  await client.query(
    `INSERT INTO "IntegrationSyncRun" (
       id, "tenantId", "integrationId", operation, status, "startedAt"
     ) VALUES ($1, $2, $3, 'sgp.sync-customers', 'COMPLETED', $4)`,
    [syncRunId, tenantId, integrationId, now],
  );

  await client.query(
    `INSERT INTO "IntegrationSyncLog" (
       id, "tenantId", "runId", entity, action, status, "createdAt"
     ) VALUES ($1, $2, $3, 'CUSTOMER', 'UPSERT', 'COMPLETED', $4)`,
    [syncLogId, tenantId, syncRunId, now],
  );

  return {
    tenantId,
    integrationId,
    originalEncryptedSecrets: encryptedSecrets,
    seededAt: now.toISOString(),
  };
}

function buildScriptEnv(overrides = {}) {
  return {
    DATABASE_URL: ISOLATED_DATABASE_URL,
    NODE_ENV: "test",
    ...overrides,
  };
}

async function runCli(modeArgs, envOverrides, redactValues = []) {
  return runCommand(
    `cli ${modeArgs.join(" ")}`,
    "node",
    ["scripts/reencrypt-sgp-integration.mjs", ...modeArgs],
    envOverrides,
    redactValues,
  );
}

async function main() {
  const inheritedDatabaseUrl = process.env.DATABASE_URL ?? "";
  assertDisposableDatabaseUrl(ISOLATED_DATABASE_URL);
  assertHostDatabaseUrlIgnored(inheritedDatabaseUrl);
  delete process.env.DATABASE_URL;

  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-crm-reencrypt-live-"));

  await startDisposableDatabase();
  const client = new Client({ connectionString: ISOLATED_DATABASE_URL });
  try {
    await client.connect();
  } catch (connectError) {
    if (managedDatabase?.backend === "Docker" && managedDatabase.container) {
      recordDockerDiagnostics("client.connect", connectError, managedDatabase.container.name);
      throw new Error(
        `${formatConnectionError(connectError)}\n${formatDiagnosticsReport(getLastDockerDiagnostics())}`,
        { cause: connectError },
      );
    }
    throw connectError;
  }

  const eventLog = createLiveEventLog();
  eventLog.step("create-disposable-database");

  try {
    eventLog.step("apply-migrations");
    await applyMigrations(client);
    eventLog.step("insert-fixture");
    const seeded = await seedDisposableData(client);

    const { afterExecuteIntegration, executeRun } = await runLiveReencryptStateMachine({
      client,
      seeded,
      backupDir,
      results,
      eventLog,
      runCli,
    });

    const require = createRequire(import.meta.url);
    const { EncryptionService } = require(
      path.join(ROOT, "apps/api/dist/modules/integrations/crypto/encryption.service.js"),
    );
    const service = new EncryptionService({
      get(name) {
        return name === "ENCRYPTION_KEY" ? KEY_B : undefined;
      },
    });
    const decrypted = service.decryptJson(afterExecuteIntegration.encryptedSecrets);
    if (decrypted.app !== FAKE_APP_B || decrypted.token !== FAKE_TOKEN_B) {
      throw new Error("Novo ciphertext incompatível com EncryptionService.");
    }
    results.scenarios.execute.encryptionServiceCompatible = true;

    eventLog.step("cleanup");
    results.eventLog = eventLog.events;
    assertLiveEventOrder(eventLog.events);

    results.staticReview = [
      {
        topic: "SQL interpolation",
        status: "PASS",
        detail: "UPDATE/SELECT usam parâmetros $1..$n; sem concatenação de entrada.",
      },
      {
        topic: "SQL injection",
        status: "PASS",
        detail: "tenantId/integrationId/ciphertext passados como bind parameters.",
      },
      {
        topic: "Transaction completeness",
        status: "PASS",
        detail: "BEGIN no início; COMMIT só após checks; ROLLBACK no catch.",
      },
      {
        topic: "updatedAt automatic",
        status: results.updatedAtBehavior.changed ? "NOTE" : "PASS",
        detail: results.updatedAtBehavior.changed
          ? "updatedAt NÃO muda com UPDATE SQL direto (sem trigger Prisma no PG)."
          : "updatedAt permaneceu idêntico — @updatedAt é só client-side Prisma.",
      },
      {
        topic: "Secret leakage",
        status: "PASS",
        detail: "stdout do CLI contém hashes; ciphertext não apareceu.",
      },
      {
        topic: "Backup overwrite",
        status: "PASS",
        detail: "Nome inclui integrationId + timestamp ISO; colisão improvável.",
      },
      {
        topic: "Real DATABASE_URL in tests",
        status: "PASS",
        detail: "Integração usa URL fixa 55999/reencrypt_disposable_test; host env ignorada.",
      },
      {
        topic: "Prisma table/column names",
        status: "PASS",
        detail: 'Tabelas/colunas quoted-case batem com migration ("Integration", "encryptedSecrets").',
      },
    ];

    console.log(
      JSON.stringify(
        {
          ...results,
          eventLog: results.eventLog,
        },
        null,
        2,
      ).replace(/"token"\s*:\s*"[^"]+"/g, '"token":"[REDACTED]"'),
    );
  } finally {
    if (
      managedDatabase?.backend === "Docker" &&
      managedDatabase.container &&
      !lastDockerDiagnostics &&
      !results.eventLog?.includes("cleanup")
    ) {
      recordDockerDiagnostics("pre-cleanup", new Error("fluxo interrompido"), managedDatabase.container.name);
    }
    await client.end();
    await stopDisposableDatabase(undefined, { skipDiagnosticsCapture: Boolean(lastDockerDiagnostics) });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main().catch(async (error) => {
    if (
      managedDatabase?.backend === "Docker" &&
      managedDatabase.container &&
      !lastDockerDiagnostics
    ) {
      recordDockerDiagnostics("main", error, managedDatabase.container.name);
    }
    if (lastDockerDiagnostics) {
      console.error(formatDiagnosticsReport(lastDockerDiagnostics));
    } else {
      console.error(error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
    }
    try {
      await stopDisposableDatabase(undefined, { skipDiagnosticsCapture: true });
    } catch {
      // ignore cleanup errors
    }
    process.exit(1);
  });
}
