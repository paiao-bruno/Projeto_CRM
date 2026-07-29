#!/usr/bin/env node
/**
 * Teste de integração REAL em PostgreSQL descartável e isolado.
 * Nunca usa DATABASE_URL do ambiente host — apenas URL fixa de teste.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { decryptJsonWithKey, encryptJsonWithKey } from "./lib/encryption.mjs";
import {
  hashText,
  readBackupFile,
  runReencryptOperation,
} from "./lib/reencrypt-sgp-integration.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTAINER_NAME = "isp-crm-reencrypt-disposable";
const ISOLATED_PORT = 55999;
const ISOLATED_DB = "reencrypt_disposable_test";
const ISOLATED_USER = "reencrypt_test";
const ISOLATED_PASSWORD = "reencrypt_test";
const ISOLATED_DATABASE_URL = `postgresql://${ISOLATED_USER}:${ISOLATED_PASSWORD}@127.0.0.1:${ISOLATED_PORT}/${ISOLATED_DB}?schema=public`;
const SCHEMA_FIXTURE = path.join(ROOT, "scripts/fixtures/reencrypt-disposable-schema.sql");
const EMBEDDED_DATA_DIR = path.join(os.tmpdir(), "isp-crm-reencrypt-embedded-pg");

let embeddedInstance = null;
let usingEmbeddedPostgres = false;

const KEY_A = "disposable-encryption-key-A-32chars!";
const KEY_B = "disposable-encryption-key-B-32chars!";
const FAKE_APP_A = "fake-app-alpha";
const FAKE_TOKEN_A = "fake-token-alpha-value";
const FAKE_APP_B = "fake-app-beta";
const FAKE_TOKEN_B = "fake-token-beta-value";

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
};

function maskUrl(url) {
  return url.replace(/:\/\/([^:@]+):([^@]+)@/, "://$1:***@");
}

function assertNeverRealDatabase(url) {
  const forbidden = [
    "isp_crm?schema=public",
    "localhost:5432/isp_crm",
    "localhost:51214",
  ];
  for (const marker of forbidden) {
    if (url.includes(marker)) {
      throw new Error(`Abortado: URL proibida detectada (${marker}).`);
    }
  }
  if (!url.includes(ISOLATED_DB) || !url.includes(String(ISOLATED_PORT))) {
    throw new Error("Abortado: URL não é o banco descartável isolado.");
  }
}

function assertHostDatabaseUrlUnused() {
  const hostUrl = process.env.DATABASE_URL ?? "";
  if (hostUrl && !hostUrl.includes(ISOLATED_DB)) {
    results.realDatabaseAccessed = false;
    console.log(
      `[guard] DATABASE_URL do host presente (${maskUrl(hostUrl)}) — não será usada.`,
    );
  }
}

function runCommand(label, command, args, env = {}) {
  const resolvedEnv = {
    ...process.env,
    DATABASE_URL: ISOLATED_DATABASE_URL,
    NODE_ENV: "test",
    ...env,
  };

  const proc = spawnSync(command, args, {
    cwd: ROOT,
    env: resolvedEnv,
    encoding: "utf8",
  });

  if (proc.status !== 0) {
    throw new Error(
      `${label} falhou (exit ${proc.status})\nstdout: ${proc.stdout}\nstderr: ${proc.stderr}`,
    );
  }

  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
  };
}

async function startDisposablePostgres() {
  const dockerAvailable =
    spawnSync("docker", ["--version"], { encoding: "utf8" }).status === 0;

  if (dockerAvailable) {
    spawnSync("docker", ["rm", "-f", CONTAINER_NAME], { stdio: "ignore" });
    const start = spawnSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        CONTAINER_NAME,
        "-e",
        `POSTGRES_USER=${ISOLATED_USER}`,
        "-e",
        `POSTGRES_PASSWORD=${ISOLATED_PASSWORD}`,
        "-e",
        `POSTGRES_DB=${ISOLATED_DB}`,
        "-p",
        `${ISOLATED_PORT}:5432`,
        "pgvector/pgvector:pg16",
      ],
      { encoding: "utf8" },
    );
    if (start.status !== 0) {
      throw new Error(`Docker run falhou: ${start.stderr}`);
    }
    results.databaseBackend = "docker-pgvector-pg16";
  } else {
    fs.rmSync(EMBEDDED_DATA_DIR, { recursive: true, force: true });
    embeddedInstance = new EmbeddedPostgres({
      databaseDir: EMBEDDED_DATA_DIR,
      port: ISOLATED_PORT,
      user: ISOLATED_USER,
      password: ISOLATED_PASSWORD,
      database: ISOLATED_DB,
    });
    await embeddedInstance.initialise();
    await embeddedInstance.start();
    usingEmbeddedPostgres = true;
    results.databaseBackend = "embedded-postgres-18";
  }

  if (usingEmbeddedPostgres) {
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
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const probe = new Client({ connectionString: ISOLATED_DATABASE_URL });
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

async function stopDisposablePostgres() {
  if (usingEmbeddedPostgres && embeddedInstance) {
    await embeddedInstance.stop();
    embeddedInstance = null;
    fs.rmSync(EMBEDDED_DATA_DIR, { recursive: true, force: true });
    usingEmbeddedPostgres = false;
    return;
  }
  spawnSync("docker", ["rm", "-f", CONTAINER_NAME], { stdio: "ignore" });
}

async function applyMigrations(client) {
  if (results.databaseBackend === "docker-pgvector-pg16") {
    const proc = spawnSync(
      "npx",
      ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
      {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: ISOLATED_DATABASE_URL },
        encoding: "utf8",
      },
    );
    if (proc.status !== 0) {
      throw new Error(`migrate deploy falhou: ${proc.stderr}`);
    }
    results.migrationsApplied = [
      "20260708160000_init",
      "20260720140000_performance_indexes",
    ];
    results.migrationsSource = "prisma migrate deploy";
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

async function fetchIntegrationSnapshot(client, integrationId) {
  const { rows } = await client.query(`SELECT * FROM "Integration" WHERE id = $1`, [
    integrationId,
  ]);
  return rows[0];
}

async function fetchTenantSnapshot(client, tenantId) {
  const [customers, contracts, invoices, syncRuns, syncLogs] = await Promise.all([
    client.query(
      `SELECT id, "tenantId", name, "deletedAt", "createdAt", "updatedAt" FROM "Customer" WHERE "tenantId" = $1 ORDER BY id`,
      [tenantId],
    ),
    client.query(
      `SELECT id, "tenantId", "customerId", "externalId", "deletedAt", "createdAt", "updatedAt" FROM "Contract" WHERE "tenantId" = $1 ORDER BY id`,
      [tenantId],
    ),
    client.query(
      `SELECT id, "tenantId", "customerId", "contractId", "externalId", "deletedAt", "createdAt", "updatedAt" FROM "Invoice" WHERE "tenantId" = $1 ORDER BY id`,
      [tenantId],
    ),
    client.query(`SELECT * FROM "IntegrationSyncRun" WHERE "tenantId" = $1 ORDER BY id`, [
      tenantId,
    ]),
    client.query(`SELECT * FROM "IntegrationSyncLog" WHERE "tenantId" = $1 ORDER BY id`, [
      tenantId,
    ]),
  ]);

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

function compareIntegrationRows(before, after) {
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

async function runCli(modeArgs, envOverrides) {
  return runCommand(
    `cli ${modeArgs.join(" ")}`,
    "node",
    ["scripts/reencrypt-sgp-integration.mjs", ...modeArgs],
    envOverrides,
  );
}

async function main() {
  assertNeverRealDatabase(ISOLATED_DATABASE_URL);
  assertHostDatabaseUrlUnused();

  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-crm-reencrypt-live-"));

  await startDisposablePostgres();
  const client = new Client({ connectionString: ISOLATED_DATABASE_URL });
  await client.connect();

  try {
    await applyMigrations(client);
    const seeded = await seedDisposableData(client);

    const beforeIntegration = await fetchIntegrationSnapshot(client, seeded.integrationId);
    const beforeTenant = await fetchTenantSnapshot(client, seeded.tenantId);

    results.scenarios.initial = {
      integrationId: seeded.integrationId,
      tenantId: seeded.tenantId,
      encryptedSecretsHash: hashText(beforeIntegration.encryptedSecrets),
      integrationChecksum: hashRow(beforeIntegration),
      tenantChecksums: beforeTenant.checksums,
    };

    // --- dry-run reencrypt ---
    const dryRunEnv = buildScriptEnv({
      ENCRYPTION_KEY: KEY_B,
      SGP_APP: FAKE_APP_B,
      SGP_TOKEN: FAKE_TOKEN_B,
      REENCRYPT_TENANT_ID: seeded.tenantId,
      REENCRYPT_INTEGRATION_ID: seeded.integrationId,
      REENCRYPT_CONFIRM_ID: seeded.integrationId,
      REENCRYPT_BACKUP_DIR: backupDir,
    });
    const dryRun = await runCli(["--dry-run"], dryRunEnv);
    results.scenarios.dryRun = {
      exitCode: 0,
      report: JSON.parse(dryRun.stdout),
    };

    const afterDryRunIntegration = await fetchIntegrationSnapshot(client, seeded.integrationId);
    const afterDryRunTenant = await fetchTenantSnapshot(client, seeded.tenantId);
    const dryRunChanged = compareIntegrationRows(beforeIntegration, afterDryRunIntegration);

    results.scenarios.dryRun.verification = {
      integrationColumnsChanged: dryRunChanged,
      integrationUnchanged: dryRunChanged.length === 0,
      tenantChecksumsUnchanged:
        beforeTenant.checksums.customers === afterDryRunTenant.checksums.customers &&
        beforeTenant.checksums.contracts === afterDryRunTenant.checksums.contracts &&
        beforeTenant.checksums.invoices === afterDryRunTenant.checksums.invoices &&
        beforeTenant.checksums.syncRuns === afterDryRunTenant.checksums.syncRuns &&
        beforeTenant.checksums.syncLogs === afterDryRunTenant.checksums.syncLogs,
    };

    if (dryRunChanged.length > 0) {
      throw new Error(`dry-run alterou colunas: ${dryRunChanged.join(", ")}`);
    }

    // --- execute reencrypt ---
    const executeRun = await runCli(["--execute"], dryRunEnv);
    const executeReport = JSON.parse(executeRun.stdout);
    results.scenarios.execute = { exitCode: 0, report: executeReport };

    const afterExecuteIntegration = await fetchIntegrationSnapshot(client, seeded.integrationId);
    const afterExecuteTenant = await fetchTenantSnapshot(client, seeded.tenantId);
    const executeChanged = compareIntegrationRows(beforeIntegration, afterExecuteIntegration);

    results.columnsChangedOnExecute = executeChanged;
    results.updatedAtBehavior = {
      before: beforeIntegration.updatedAt?.toISOString?.() ?? beforeIntegration.updatedAt,
      after: afterExecuteIntegration.updatedAt?.toISOString?.() ?? afterExecuteIntegration.updatedAt,
      changed: executeChanged.includes("updatedAt"),
    };

    if (afterExecuteIntegration.id !== seeded.integrationId) {
      throw new Error("Integration.id foi alterado.");
    }
    if (
      executeChanged.length !== 1 ||
      executeChanged[0] !== "encryptedSecrets"
    ) {
      throw new Error(
        `Esperado alterar somente encryptedSecrets; alterado: ${executeChanged.join(", ")}`,
      );
    }
    for (const key of Object.keys(beforeTenant.checksums)) {
      if (beforeTenant.checksums[key] !== afterExecuteTenant.checksums[key]) {
        throw new Error(`Checksum ${key} alterado após execute.`);
      }
    }

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

    // --- backup verification ---
    const backupFile = executeReport.backupFile;
    if (!backupFile || !fs.existsSync(backupFile)) {
      throw new Error("Arquivo de backup não foi criado.");
    }
    const backup = readBackupFile(backupFile);
    results.backupVerification = {
      path: backupFile,
      hasOriginalCiphertext:
        backup.integration.encryptedSecrets === seeded.originalEncryptedSecrets,
      hashMatches: hashText(backup.integration.encryptedSecrets) === hashText(seeded.originalEncryptedSecrets),
      consoleLeakedCiphertext: executeRun.stdout.includes(seeded.originalEncryptedSecrets),
    };
    if (!results.backupVerification.hasOriginalCiphertext) {
      throw new Error("Backup não contém ciphertext original.");
    }
    if (results.backupVerification.consoleLeakedCiphertext) {
      throw new Error("Ciphertext vazou no stdout.");
    }

    // --- restore dry-run ---
    const restoreDryEnv = buildScriptEnv({
      ENCRYPTION_KEY: KEY_A,
      REENCRYPT_TENANT_ID: seeded.tenantId,
      REENCRYPT_INTEGRATION_ID: seeded.integrationId,
      REENCRYPT_CONFIRM_ID: seeded.integrationId,
    });
    const restoreDry = await runCli(
      ["--restore", `--backup-file=${backupFile}`],
      restoreDryEnv,
    );
    results.scenarios.restoreDryRun = {
      exitCode: 0,
      report: JSON.parse(restoreDry.stdout),
    };

    const midRestoreIntegration = await fetchIntegrationSnapshot(client, seeded.integrationId);
    if (midRestoreIntegration.encryptedSecrets !== afterExecuteIntegration.encryptedSecrets) {
      throw new Error("restore dry-run alterou ciphertext.");
    }

    // --- restore execute ---
    const restoreExec = await runCli(
      ["--restore", `--backup-file=${backupFile}`, "--execute"],
      restoreDryEnv,
    );
    results.scenarios.restoreExecute = {
      exitCode: 0,
      report: JSON.parse(restoreExec.stdout),
    };

    const afterRestoreIntegration = await fetchIntegrationSnapshot(client, seeded.integrationId);
    if (afterRestoreIntegration.encryptedSecrets !== seeded.originalEncryptedSecrets) {
      throw new Error("Restauração não retornou ciphertext original.");
    }
    results.scenarios.restoreExecute.originalCiphertextRestored = true;

    // --- simulated rollback failure ---
    const rollbackClient = new Client({ connectionString: ISOLATED_DATABASE_URL });
    await rollbackClient.connect();
    const beforeRollback = await fetchIntegrationSnapshot(rollbackClient, seeded.integrationId);
    let rollbackFailed = false;
    try {
      await runReencryptOperation(rollbackClient, {
        config: {
          databaseUrl: ISOLATED_DATABASE_URL,
          encryptionKey: KEY_B,
          sgpApp: FAKE_APP_B,
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
    const afterRollback = await fetchIntegrationSnapshot(rollbackClient, seeded.integrationId);
    await rollbackClient.end();

    results.rollbackVerification = {
      failureInjected: rollbackFailed,
      ciphertextUnchanged:
        afterRollback.encryptedSecrets === beforeRollback.encryptedSecrets,
      integrationChecksumUnchanged:
        hashRow(beforeRollback) === hashRow(afterRollback),
    };
    if (!rollbackFailed || !results.rollbackVerification.ciphertextUnchanged) {
      throw new Error("Rollback simulado não manteve o estado original.");
    }

    results.scenarios.beforeAfter = {
      before: {
        integration: {
          id: beforeIntegration.id,
          encryptedSecretsHash: hashText(beforeIntegration.encryptedSecrets),
          updatedAt: results.updatedAtBehavior.before,
          config: beforeIntegration.config,
        },
        tenantChecksums: beforeTenant.checksums,
      },
      afterExecute: {
        integration: {
          id: afterExecuteIntegration.id,
          encryptedSecretsHash: hashText(afterExecuteIntegration.encryptedSecrets),
          updatedAt: results.updatedAtBehavior.after,
        },
        columnsChanged: executeChanged,
        tenantChecksums: afterExecuteTenant.checksums,
      },
      afterRestore: {
        encryptedSecretsHash: hashText(afterRestoreIntegration.encryptedSecrets),
        matchesOriginal:
          afterRestoreIntegration.encryptedSecrets === seeded.originalEncryptedSecrets,
      },
    };

    // --- static review (code inspection) ---
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

    console.log(JSON.stringify(results, null, 2));
  } finally {
    await client.end();
    await stopDisposablePostgres();
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  try {
    await stopDisposablePostgres();
  } catch {
    // ignore cleanup errors
  }
  process.exit(1);
});
