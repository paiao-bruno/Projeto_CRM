import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  decryptJsonWithKey,
  encryptJsonWithKey,
  encryptWithKey,
  decryptWithKey,
} from "./lib/encryption.mjs";
import {
  assertIntegrityUnchanged,
  assertIntegrationColumnsUnchanged,
  buildBackupSnapshot,
  buildNextEncryptedSecrets,
  collectReencryptValidationErrors,
  collectTenantIntegrity,
  createDryRunProof,
  decodeDryRunProofToken,
  encodeDryRunProofToken,
  formatValidationFailure,
  hashText,
  locateIntegrationForUpdate,
  readBackupFile,
  readReencryptEnv,
  runPreflight,
  runReencryptOperation,
  sanitizeIntegrationView,
  sanitizePgConnectError,
  validateReencryptEnv,
  verifyDryRunProofForExecute,
  writeBackupFile,
} from "./lib/reencrypt-sgp-integration.mjs";
import * as liveIntegration from "./reencrypt-sgp-integration.integration.mjs";

const PREFLIGHT_BACKUP_DIR = path.join(os.tmpdir(), "isp-crm-preflight-test");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TEST_KEY = "test-encryption-key-with-32-characters-min";
const OTHER_KEY = "other-encryption-key-with-32-characters-m";
const TEST_DATABASE_URL = "postgresql://test:test@127.0.0.1:59999/isolated_test_only";

function assertNeverUsesRealDatabaseUrl() {
  const envUrl = process.env.DATABASE_URL ?? "";
  if (envUrl && !envUrl.includes("59999") && !envUrl.includes("isolated_test_only")) {
    throw new Error(
      "Testes abortados: DATABASE_URL real detectada. Use ambiente isolado ou deixe DATABASE_URL vazia.",
    );
  }
}

function createMockIntegration(overrides = {}) {
  return {
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    tenantId: overrides.tenantId ?? "22222222-2222-4222-8222-222222222222",
    provider: "SGP",
    name: overrides.name ?? "SGP",
    status: "ACTIVE",
    healthStatus: "UNKNOWN",
    config: { apiUrl: "https://example.sgp.net.br", timeoutMs: 15000 },
    encryptedSecrets: overrides.encryptedSecrets ??
      encryptJsonWithKey(TEST_KEY, { app: "siac", token: "old-token-value" }),
    lastConnectedAt: null,
    lastError: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function createMockClient(state) {
  return {
    state,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();

      if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
        state.transaction = normalized;
        return { rows: [], rowCount: 0 };
      }

      if (normalized.includes('FROM "Customer"')) {
        return { rows: state.customers.map((id) => ({ id })) };
      }
      if (normalized.includes('FROM "Contract"')) {
        return { rows: state.contracts.map((id) => ({ id })) };
      }
      if (normalized.includes('FROM "Invoice"')) {
        return { rows: state.invoices.map((id) => ({ id })) };
      }
      if (normalized.includes('FROM "IntegrationSyncRun"')) {
        return { rows: state.syncRuns.map((id) => ({ id })) };
      }
      if (normalized.includes('FROM "IntegrationSyncLog"')) {
        return { rows: state.syncLogs.map((id) => ({ id })) };
      }
      if (normalized.includes('FROM "Integration" WHERE "tenantId" = $1 ORDER BY id')) {
        return { rows: state.integrations.map((item) => ({ id: item.id })) };
      }
      if (
        normalized.includes('FROM "Integration"') &&
        normalized.includes('"encryptedSecrets"') &&
        !normalized.includes("FOR UPDATE")
      ) {
        const match = state.integrations.find(
          (item) =>
            item.tenantId === params[0] && item.id === params[1] && item.provider === "SGP",
        );
        return { rows: match ? [{ encryptedSecrets: match.encryptedSecrets }] : [] };
      }
      if (
        normalized.includes('FROM "Integration"') &&
        normalized.includes('FOR UPDATE')
      ) {
        const match = state.integrations.find(
          (item) =>
            item.tenantId === params[0] && item.id === params[1] && item.provider === "SGP",
        );
        return { rows: match ? [{ ...match }] : [] };
      }
      if (normalized.startsWith('UPDATE "Integration" SET "encryptedSecrets"')) {
        const integration = state.integrations.find(
          (item) =>
            item.id === params[1] &&
            item.tenantId === params[2] &&
            item.provider === "SGP",
        );
        if (!integration) {
          return { rowCount: 0, rows: [] };
        }
        integration.encryptedSecrets = params[0];
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`SQL não mockado: ${normalized}`);
    },
  };
}

describe("encryption.mjs", () => {
  it("round-trips json secrets", () => {
    const encrypted = encryptJsonWithKey(TEST_KEY, { app: "siac", token: "abc" });
    const decrypted = decryptJsonWithKey(TEST_KEY, encrypted);
    assert.equal(decrypted.app, "siac");
    assert.equal(decrypted.token, "abc");
  });
});

describe("encryption compatibility with EncryptionService", () => {
  it("interoperates with apps/api EncryptionService after build", async () => {
    const require = createRequire(import.meta.url);
    const servicePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../apps/api/dist/modules/integrations/crypto/encryption.service.js",
    );

    if (!fs.existsSync(servicePath)) {
      throw new Error(
        "apps/api/dist não encontrado. Execute npm run build -w apps/api antes dos testes de compatibilidade.",
      );
    }

    const { EncryptionService } = require(servicePath);
    const service = new EncryptionService({
      get(name) {
        return name === "ENCRYPTION_KEY" ? TEST_KEY : undefined;
      },
    });

    const payload = { app: "siac", token: "compat-token-value" };
    const fromService = service.encryptJson(payload);
    const fromScript = encryptJsonWithKey(TEST_KEY, payload);

    assert.deepEqual(decryptJsonWithKey(TEST_KEY, fromService), payload);
    assert.deepEqual(service.decryptJson(fromScript), payload);
    assert.notEqual(fromService, fromScript);
  });
});

describe("reencrypt-sgp-integration core", () => {
  it("validates required env and confirm id", () => {
    assert.throws(
      () =>
        validateReencryptEnv(
          {
            databaseUrl: TEST_DATABASE_URL,
            encryptionKey: TEST_KEY,
            sgpApp: "siac",
            sgpToken: "token",
            tenantId: "t1",
            integrationId: "i1",
            confirmId: "i2",
            allowProduction: false,
            backupDir: "",
            nodeEnv: "test",
          },
          { mode: "reencrypt" },
        ),
      /REENCRYPT_CONFIRM_ID/,
    );
  });

  it("blocks production without explicit confirmation", () => {
    assert.throws(
      () =>
        validateReencryptEnv(
          {
            databaseUrl: TEST_DATABASE_URL,
            encryptionKey: TEST_KEY,
            sgpApp: "siac",
            sgpToken: "token",
            tenantId: "t1",
            integrationId: "i1",
            confirmId: "i1",
            allowProduction: false,
            backupDir: "",
            nodeEnv: "production",
          },
          { mode: "reencrypt" },
        ),
      /NODE_ENV=production/,
    );
  });

  it("dry-run does not mutate integration ciphertext", async () => {
    assertNeverUsesRealDatabaseUrl();
    const integration = createMockIntegration();
    const state = {
      integrations: [integration],
      customers: ["c1"],
      contracts: ["ct1"],
      invoices: ["inv1"],
      syncRuns: ["run1"],
      syncLogs: ["log1"],
      transaction: null,
    };
    const client = createMockClient(state);
    const previous = integration.encryptedSecrets;

    const report = await runReencryptOperation(client, {
      config: {
        databaseUrl: TEST_DATABASE_URL,
        encryptionKey: TEST_KEY,
        sgpApp: "siac",
        sgpToken: "new-token-value",
        tenantId: integration.tenantId,
        integrationId: integration.id,
        confirmId: integration.id,
        allowProduction: false,
        backupDir: "",
        nodeEnv: "test",
      },
      mode: "reencrypt",
      write: false,
      rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    });

    assert.equal(report.write, false);
    assert.equal(integration.encryptedSecrets, previous);
    assert.equal(report.integrity.before.counts.customers, 1);
    assert.equal(report.integrity.after.counts.customers, 1);
  });

  it("execute updates only encryptedSecrets and preserves imported entities", async () => {
    assertNeverUsesRealDatabaseUrl();
    const integration = createMockIntegration();
    const beforeRow = { ...integration };
    const state = {
      integrations: [integration],
      customers: ["c1", "c2"],
      contracts: ["ct1"],
      invoices: ["inv1", "inv2", "inv3"],
      syncRuns: ["run1"],
      syncLogs: ["log1", "log2"],
      transaction: null,
    };
    const client = createMockClient(state);
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-crm-backup-test-"));

    const report = await runReencryptOperation(client, {
      config: {
        databaseUrl: TEST_DATABASE_URL,
        encryptionKey: OTHER_KEY,
        sgpApp: "siac",
        sgpToken: "rotated-token-value",
        tenantId: integration.tenantId,
        integrationId: integration.id,
        confirmId: integration.id,
        allowProduction: false,
        backupDir,
        nodeEnv: "test",
      },
      mode: "reencrypt",
      write: true,
      rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    });

    assert.notEqual(integration.encryptedSecrets, beforeRow.encryptedSecrets);
    assertIntegrationColumnsUnchanged(beforeRow, integration);
    assertIntegrityUnchanged(report.integrity.before, report.integrity.after);

    const decrypted = decryptJsonWithKey(OTHER_KEY, integration.encryptedSecrets);
    assert.equal(decrypted.app, "siac");
    assert.equal(decrypted.token, "rotated-token-value");

    assert.ok(report.backupFile);
    assert.ok(fs.existsSync(report.backupFile));
    const backup = readBackupFile(report.backupFile);
    assert.equal(backup.integration.encryptedSecrets, beforeRow.encryptedSecrets);
    assert.equal(
      backup.encryptedSecretsHash,
      hashText(beforeRow.encryptedSecrets),
    );
  });

  it("restore mode writes backup ciphertext back without touching entities", async () => {
    assertNeverUsesRealDatabaseUrl();
    const integration = createMockIntegration();
    const originalSecrets = integration.encryptedSecrets;
    integration.encryptedSecrets = encryptJsonWithKey(OTHER_KEY, {
      app: "siac",
      token: "temporary",
    });

    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-crm-backup-test-"));
    const backupFile = path.join(backupDir, "restore-me.json");
    writeBackupFile(
      backupFile,
      buildBackupSnapshot({ ...integration, encryptedSecrets: originalSecrets }),
    );

    const state = {
      integrations: [integration],
      customers: ["c1"],
      contracts: [],
      invoices: ["inv1"],
      syncRuns: [],
      syncLogs: [],
      transaction: null,
    };
    const client = createMockClient(state);

    const report = await runReencryptOperation(client, {
      config: {
        databaseUrl: TEST_DATABASE_URL,
        encryptionKey: TEST_KEY,
        sgpApp: "",
        sgpToken: "",
        tenantId: integration.tenantId,
        integrationId: integration.id,
        confirmId: integration.id,
        allowProduction: false,
        backupDir,
        nodeEnv: "test",
      },
      mode: "restore",
      write: true,
      backupFilePath: backupFile,
      rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    });

    assert.equal(integration.encryptedSecrets, originalSecrets);
    assert.equal(report.mode, "restore");
    assert.equal(report.integrity.before.counts.customers, 1);
    assert.equal(report.integrity.after.counts.customers, 1);
  });

  it("sanitizeIntegrationView never exposes ciphertext", () => {
    const integration = createMockIntegration();
    const view = sanitizeIntegrationView(integration);
    assert.equal(view.encryptedSecretsPresent, true);
    assert.ok(view.encryptedSecretsHash);
    assert.equal("encryptedSecrets" in view, false);
    assert.equal(view.apiUrl, "https://example.sgp.net.br");
  });

  it("readReencryptEnv reads non-secret identifiers only", () => {
    const config = readReencryptEnv({
      DATABASE_URL: TEST_DATABASE_URL,
      ENCRYPTION_KEY: TEST_KEY,
      SGP_APP: "siac",
      SGP_TOKEN: "secret",
      REENCRYPT_TENANT_ID: "tenant",
      REENCRYPT_INTEGRATION_ID: "integration",
      REENCRYPT_CONFIRM_ID: "integration",
    });
    assert.equal(config.tenantId, "tenant");
    assert.equal(config.integrationId, "integration");
  });
});

describe("reencrypt-sgp-integration integrity helpers", () => {
  it("collectTenantIntegrity aggregates counts and checksums", async () => {
    const client = createMockClient({
      customers: ["a", "b"],
      contracts: ["c"],
      invoices: [],
      syncRuns: ["r1"],
      syncLogs: ["l1", "l2"],
      integrations: [{ id: "i1" }],
    });

    const integrity = await collectTenantIntegrity(client, "tenant-x");
    assert.equal(integrity.counts.customers, 2);
    assert.equal(integrity.counts.integrationSyncLogs, 2);
    assert.ok(integrity.checksums.customers);
  });

  it("buildNextEncryptedSecrets validates decryptability before returning", () => {
    const encrypted = buildNextEncryptedSecrets(TEST_KEY, "siac", "fresh-token");
    const decrypted = decryptJsonWithKey(TEST_KEY, encrypted);
    assert.equal(decrypted.token, "fresh-token");
  });
});

describe("reencrypt-sgp-integration database guard", () => {
  it("refuses to run when real DATABASE_URL is present", () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://crm:crm@localhost:5432/isp_crm?schema=public";
    try {
      assert.throws(() => assertNeverUsesRealDatabaseUrl(), /DATABASE_URL real/);
    } finally {
      process.env.DATABASE_URL = previous;
    }
  });
});

describe("reencrypt-sgp-integration live disposable guards", () => {
  it("accepts only the fixed disposable database URL", () => {
    assert.doesNotThrow(() =>
      liveIntegration.assertDisposableDatabaseUrl(liveIntegration.ISOLATED_DATABASE_URL),
    );
  });

  it("rejects port 5432 in disposable URL", () => {
    assert.throws(
      () =>
        liveIntegration.assertDisposableDatabaseUrl(
          "postgresql://reencrypt_test:reencrypt_test@127.0.0.1:5432/reencrypt_disposable_test?schema=public",
        ),
      /5432/,
    );
  });

  it("rejects isp_crm database in disposable URL", () => {
    assert.throws(
      () =>
        liveIntegration.assertDisposableDatabaseUrl(
          "postgresql://reencrypt_test:reencrypt_test@127.0.0.1:55999/isp_crm?schema=public",
        ),
      /isp_crm/,
    );
  });

  it("logs inherited DATABASE_URL without using it", () => {
    assert.doesNotThrow(() =>
      liveIntegration.assertHostDatabaseUrlIgnored(
        "postgresql://crm:crm@localhost:5432/isp_crm?schema=public",
      ),
    );
  });

  it("does not import embedded-postgres when Docker is available", async () => {
    let embeddedImportCalled = false;
    const started = await liveIntegration.startDisposableDatabase({
      checkDockerAvailable: () => true,
      checkPortAvailable: async () => undefined,
      runDockerReadinessPipeline: async () => ({
        containerId: "sha256:disposable-test-id",
        restartCount: 0,
      }),
      startDockerContainer: () => ({
        backend: "Docker",
        container: {
          name: liveIntegration.DISPOSABLE_CONTAINER_NAME,
          id: "sha256:disposable-test-id",
        },
      }),
      startEmbeddedPostgresFallback: async () => {
        embeddedImportCalled = true;
        throw new Error("embedded-postgres não deveria ser carregado");
      },
      importEmbeddedPostgresModule: async () => {
        embeddedImportCalled = true;
        throw new Error("embedded-postgres não deveria ser importado");
      },
    });

    assert.equal(started.backend, "Docker");
    assert.equal(embeddedImportCalled, false);
    await liveIntegration.stopDisposableDatabase(started, {
      assertCleanupTarget: () => undefined,
      removeDockerContainer: () => undefined,
    });
  });

  it("imports embedded-postgres only after Docker is unavailable", async () => {
    let embeddedImportCalled = false;
    const started = await liveIntegration.startDisposableDatabase({
      checkDockerAvailable: () => false,
      checkPortAvailable: async () => undefined,
      waitForDisposablePostgres: async () => undefined,
      startDockerContainer: () => {
        throw new Error("Docker não deveria ser iniciado");
      },
      startEmbeddedPostgresFallback: async (importModule) => {
        await importModule();
        embeddedImportCalled = true;
        return {
          backend: "embedded-postgres",
          embedded: {
            async stop() {},
          },
        };
      },
      importEmbeddedPostgresModule: async () => {
        return {
          default: class MockEmbeddedPostgres {
            async initialise() {}
            async start() {}
            async stop() {}
          },
        };
      },
    });

    assert.equal(started.backend, "embedded-postgres");
    assert.equal(embeddedImportCalled, true);
    await liveIntegration.stopDisposableDatabase(started);
  });

  it("cleanup rejects containers other than the disposable test container", () => {
    assert.throws(
      () =>
        liveIntegration.assertCleanupTarget({
          name: "isp-crm-postgres",
          id: "sha256:other-container",
        }),
      /Cleanup abortado/,
    );

    assert.throws(
      () => liveIntegration.assertCleanupTarget(null),
      /Cleanup abortado/,
    );

    assert.equal(liveIntegration.DISPOSABLE_CONTAINER_NAME, "isp-crm-reencrypt-test");
  });
});

describe("reencrypt-sgp-integration docker prisma migration", () => {
  it("buildDisposableProcessEnv removes inherited DATABASE_URL and keeps disposable URL only", () => {
    const env = liveIntegration.buildDisposableProcessEnv({
      DATABASE_URL: "postgresql://crm:crm@localhost:5432/isp_crm?schema=public",
      SHADOW_DATABASE_URL: "postgresql://crm:crm@localhost:5432/isp_crm_shadow?schema=public",
    });
    assert.equal(env.DATABASE_URL, liveIntegration.ISOLATED_DATABASE_URL);
    assert.equal(env.SHADOW_DATABASE_URL, undefined);
    assert.doesNotMatch(env.DATABASE_URL, /isp_crm/);
    assert.doesNotMatch(env.DATABASE_URL, /:5432/);
  });

  it("formatSubprocessFailure captures stderr on non-zero exit", () => {
    const message = liveIntegration.formatSubprocessFailure(
      "prisma migrate deploy",
      {
        command: process.execPath,
        args: ["prisma", "migrate", "deploy"],
        cwd: "/tmp/project",
      },
      {
        status: 1,
        signal: null,
        error: undefined,
        stdout: "",
        stderr: "Migration failed: extension vector",
      },
    );
    assert.match(message, /stderr: Migration failed/);
    assert.match(message, /exitCode: 1/);
    assert.match(message, /reencrypt_test:\*\*\*@127\.0\.0\.1:55999/);
    assert.doesNotMatch(message, /reencrypt_test:reencrypt_test/);
  });

  it("formatSubprocessFailure captures stdout", () => {
    const message = liveIntegration.formatSubprocessFailure(
      "prisma migrate deploy",
      { command: "node", args: [], cwd: "/tmp/project" },
      {
        status: 1,
        stdout: "Applying migration 20260708160000_init",
        stderr: "",
      },
    );
    assert.match(message, /stdout: Applying migration/);
  });

  it("formatSubprocessFailure captures spawn error when command cannot start", () => {
    const message = liveIntegration.formatSubprocessFailure(
      "prisma migrate deploy",
      { command: "npx", args: ["prisma"], cwd: "/tmp/project" },
      {
        status: null,
        signal: null,
        error: new Error("spawn npx ENOENT"),
        stdout: undefined,
        stderr: undefined,
      },
    );
    assert.match(message, /error\.message: spawn npx ENOENT/);
    assert.match(message, /stderr: \(vazio\)/);
    assert.match(message, /stdout: \(vazio\)/);
    assert.doesNotMatch(message, /undefined/);
  });

  it("runPrismaMigrateDeploy throws sanitized diagnostics instead of undefined", () => {
    assert.throws(
      () =>
        liveIntegration.runPrismaMigrateDeploy({
          runSubprocess: () => ({
            status: null,
            signal: null,
            error: new Error("spawn npx ENOENT"),
            stdout: undefined,
            stderr: undefined,
          }),
        }),
      (error) =>
        error instanceof Error &&
        error.message.includes("prisma migrate deploy") &&
        error.message.includes("spawn npx ENOENT") &&
        !error.message.includes("undefined"),
    );
  });

  it("waitForDockerPostgresReady times out with sanitized diagnostics", async () => {
    await assert.rejects(
      () =>
        liveIntegration.waitForDockerPostgresReady("isp-crm-reencrypt-test", {
          timeoutMs: 50,
          intervalMs: 10,
          runDockerExec: () => ({
            status: 2,
            signal: null,
            stdout: "",
            stderr: "connection refused",
          }),
        }),
      (error) =>
        error instanceof Error &&
        error.message.includes("[pg_isready] timeout") &&
        error.message.includes("connection refused"),
    );
  });

  it("applyDockerPrismaMigrations propagates prisma failure without fallback", async () => {
    await assert.rejects(
      () =>
        liveIntegration.applyDockerPrismaMigrations(
          {
            query: async () => ({ rows: [] }),
          },
          {
            runSubprocess: () => ({
              status: 1,
              signal: null,
              stdout: "stdout detail",
              stderr: "stderr detail",
            }),
          },
        ),
      /stderr detail/,
    );
  });

  it("runDockerReadinessPipeline runs pg_isready and tcp stability stages", async () => {
    const stages = [];
    await liveIntegration.runDockerReadinessPipeline(
      {
        name: liveIntegration.DISPOSABLE_CONTAINER_NAME,
        id: "sha256:stable-id",
        restartCount: 0,
      },
      liveIntegration.ISOLATED_DATABASE_URL,
      {
        timeoutMs: 200,
        intervalMs: 10,
        logStage: (stage) => stages.push(stage),
        waitForTcpSelectOneStability: async () => ({ consecutive: 3, lastError: null }),
        runDockerExec: (args) => {
          if (args.includes("pg_isready")) {
            return { status: 0, stdout: "accepting connections\n", stderr: "" };
          }
          return { status: 0, stdout: "", stderr: "" };
        },
        runDocker: (args) => {
          if (args.includes("{{.State.Status}}")) {
            return { status: 0, stdout: "running\n", stderr: "" };
          }
          if (args.includes("{{.State.Health.Status}}")) {
            return { status: 0, stdout: "healthy\n", stderr: "" };
          }
          if (args.includes("{{.Id}}")) {
            return { status: 0, stdout: "sha256:stable-id\n", stderr: "" };
          }
          if (args.includes("{{.RestartCount}}")) {
            return { status: 0, stdout: "0\n", stderr: "" };
          }
          if (args.includes("pg_isready")) {
            return { status: 0, stdout: "accepting connections\n", stderr: "" };
          }
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    );
    assert.ok(stages.some((item) => item.includes("container-ready")));
  });
});

describe("reencrypt-sgp-integration live dry-run proof propagation", () => {
  const sampleToken = "proof-token-value-not-for-logs";
  const sampleReport = {
    mode: "dry-run",
    dryRunProof: {
      token: sampleToken,
      proofId: "proof-123",
      expiresAt: "2026-07-29T20:00:00.000Z",
    },
  };

  it("extractDryRunProofToken requires non-empty string token", () => {
    assert.equal(liveIntegration.extractDryRunProofToken(sampleReport), sampleToken);
    assert.throws(
      () => liveIntegration.extractDryRunProofToken({ dryRunProof: {} }),
      /dryRunProof\.token ausente/,
    );
  });

  it("runReencryptDryRunThenExecute runs dry-run before execute and propagates token via env", async () => {
    const calls = [];
    const runCliFn = async (modeArgs, envOverrides, redactValues = []) => {
      calls.push({ modeArgs, env: { ...envOverrides }, redactValues });
      if (modeArgs.includes("--dry-run")) {
        return { stdout: JSON.stringify(sampleReport), stderr: "" };
      }
      if (modeArgs.includes("--execute")) {
        assert.equal(envOverrides.REENCRYPT_DRY_RUN_PROOF, sampleToken);
        return { stdout: JSON.stringify({ mode: "execute", ok: true }), stderr: "" };
      }
      throw new Error(`modo inesperado: ${modeArgs.join(" ")}`);
    };

    const baseEnv = {
      DATABASE_URL: liveIntegration.ISOLATED_DATABASE_URL,
      REENCRYPT_TENANT_ID: "22222222-2222-4222-8222-222222222222",
    };
    const result = await liveIntegration.runReencryptDryRunThenExecute(runCliFn, baseEnv);

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].modeArgs, ["--dry-run"]);
    assert.equal(calls[0].env.REENCRYPT_DRY_RUN_PROOF, undefined);
    assert.deepEqual(calls[1].modeArgs, ["--execute"]);
    assert.equal(calls[1].env.REENCRYPT_DRY_RUN_PROOF, sampleToken);
    assert.equal(result.proofToken, sampleToken);
  });

  it("runReencryptDryRunThenExecute does not call execute when dry-run fails", async () => {
    let executeCalled = false;
    const runCliFn = async (modeArgs) => {
      if (modeArgs.includes("--dry-run")) {
        throw new Error("dry-run subprocess failed");
      }
      executeCalled = true;
      return { stdout: "{}", stderr: "" };
    };

    await assert.rejects(
      () => liveIntegration.runReencryptDryRunThenExecute(runCliFn, {}),
      /dry-run subprocess failed/,
    );
    assert.equal(executeCalled, false);
  });

  it("sanitizeProcessOutput redacts dry-run proof token from diagnostics", () => {
    const sanitized = liveIntegration.sanitizeProcessOutput(
      `stdout contém token ${sampleToken} no meio`,
      [sampleToken],
    );
    assert.doesNotMatch(sanitized, new RegExp(sampleToken));
    assert.match(sanitized, /\[REDACTED\]/);
  });

  it("redactDryRunReportForOutput removes token from serializable report", () => {
    const redacted = liveIntegration.redactDryRunReportForOutput(sampleReport);
    assert.equal(redacted.dryRunProof.token, "[REDACTED]");
    assert.equal(redacted.dryRunProof.proofId, "proof-123");
  });

  it("buildExecuteEnvFromDryRun rejects missing proof token", () => {
    assert.throws(
      () => liveIntegration.buildExecuteEnvFromDryRun({}, ""),
      /dryRunProof\.token ausente/,
    );
  });
});

describe("reencrypt-sgp-integration preflight and execute guards", () => {
  const baseConfig = () => ({
    databaseUrl:
      "postgresql://reencrypt_test:reencrypt_test@127.0.0.1:55999/reencrypt_disposable_test?schema=public",
    encryptionKey: TEST_KEY,
    sgpApp: "siac",
    sgpToken: "fake-token-value",
    tenantId: "22222222-2222-4222-8222-222222222222",
    integrationId: "11111111-1111-4111-8111-111111111111",
    confirmId: "11111111-1111-4111-8111-111111111111",
    allowProduction: false,
    skipDryRunProof: false,
    dryRunProof: "",
    backupDir: PREFLIGHT_BACKUP_DIR,
    nodeEnv: "test",
  });

  it("preflight succeeds without connecting to the database", () => {
    const report = runPreflight(baseConfig(), { preflight: true, restore: false }, ROOT);
    assert.equal(report.connectsToDatabase, false);
    assert.equal(report.readsIntegration, false);
    assert.equal(report.writesBackup, false);
    assert.equal(report.runsTransaction, false);
    assert.equal(report.ok, true);
    assert.equal(report.checks.databaseUrlPresent, true);
    assert.match(report.masked.databaseUrl, /reencrypt_test:\*\*\*@127\.0\.0\.1:55999/);
    assert.doesNotMatch(JSON.stringify(report), /fake-token-value/);
  });

  it("lists missing variables without exposing values", () => {
    const validation = collectReencryptValidationErrors(
      { ...baseConfig(), databaseUrl: "", encryptionKey: "", sgpApp: "", sgpToken: "" },
      { mode: "reencrypt", args: {} },
    );
    assert.equal(validation.ok, false);
    const message = formatValidationFailure(validation);
    assert.match(message, /DATABASE_URL/);
    assert.match(message, /ENCRYPTION_KEY/);
    assert.match(message, /SGP_APP/);
    assert.match(message, /SGP_TOKEN/);
    assert.doesNotMatch(message, /fake-token/);
  });

  it("rejects invalid UUIDs before connection", () => {
    const validation = collectReencryptValidationErrors(
      {
        ...baseConfig(),
        tenantId: "not-a-uuid",
        integrationId: "also-invalid",
        confirmId: "also-invalid",
      },
      { mode: "reencrypt", args: {} },
    );
    assert.match(formatValidationFailure(validation), /REENCRYPT_TENANT_ID deve ser UUID válido/);
  });

  it("rejects incompatible flags in preflight", () => {
    const report = runPreflight(baseConfig(), { preflight: true, write: true }, ROOT);
    assert.equal(report.ok, false);
    assert.match(report.errors.join(" "), /--preflight não pode ser combinado com --execute/);
  });

  it("sanitizes pg SASL password error", () => {
    const message = sanitizePgConnectError(new Error("SASL: client password must be a string"));
    assert.match(message, /senha ausente ou inválida/);
    assert.doesNotMatch(message, /SASL:/);
  });

  it("dry-run proof encodes and verifies without secrets", async () => {
    const integration = createMockIntegration({
      encryptedSecrets: encryptJsonWithKey(TEST_KEY, { app: "siac", token: "old-token-value" }),
    });
    const client = createMockClient({
      integrations: [integration],
      customers: ["c1"],
      contracts: [],
      invoices: [],
      syncRuns: [],
      syncLogs: [],
    });
    const integrity = await collectTenantIntegrity(client, integration.tenantId);
    const proof = createDryRunProof({
      integrationId: integration.id,
      tenantId: integration.tenantId,
      integrityChecksums: integrity.checksums,
      encryptedSecretsHash: hashText(integration.encryptedSecrets),
    });
    const token = encodeDryRunProofToken(proof);
    assert.doesNotMatch(token, /old-token-value/);

    await verifyDryRunProofForExecute(client, {
      ...baseConfig(),
      tenantId: integration.tenantId,
      integrationId: integration.id,
      confirmId: integration.id,
    }, token);
  });

  it("invalidates proof when checksum changes after dry-run", async () => {
    const integration = createMockIntegration();
    const clientBefore = createMockClient({
      integrations: [integration],
      customers: ["c1"],
      contracts: [],
      invoices: [],
      syncRuns: [],
      syncLogs: [],
    });
    const integrityBefore = await collectTenantIntegrity(clientBefore, integration.tenantId);
    const proof = createDryRunProof({
      integrationId: integration.id,
      tenantId: integration.tenantId,
      integrityChecksums: integrityBefore.checksums,
      encryptedSecretsHash: hashText(integration.encryptedSecrets),
    });
    const token = encodeDryRunProofToken(proof);

    const clientAfter = createMockClient({
      integrations: [integration],
      customers: ["c1", "c2"],
      contracts: [],
      invoices: [],
      syncRuns: [],
      syncLogs: [],
    });

    await assert.rejects(
      () =>
        verifyDryRunProofForExecute(clientAfter, {
          ...baseConfig(),
          tenantId: integration.tenantId,
          integrationId: integration.id,
          confirmId: integration.id,
        }, token),
      /banco alterado desde o dry-run/,
    );
  });

  it("dry-run attaches proof token to report", async () => {
    const integration = createMockIntegration();
    const state = {
      integrations: [integration],
      customers: ["c1"],
      contracts: [],
      invoices: [],
      syncRuns: [],
      syncLogs: [],
      transaction: null,
    };
    const client = createMockClient(state);

    const report = await runReencryptOperation(client, {
      config: {
        ...baseConfig(),
        databaseUrl: TEST_DATABASE_URL,
        tenantId: integration.tenantId,
        integrationId: integration.id,
        confirmId: integration.id,
      },
      mode: "reencrypt",
      write: false,
      rootDir: ROOT,
      args: {},
    });

    assert.ok(report.dryRunProof?.token);
    assert.ok(report.dryRunProof?.proofId);
    assert.doesNotMatch(JSON.stringify(report), /old-token-value/);
    const decoded = decodeDryRunProofToken(report.dryRunProof.token);
    assert.equal(decoded.integrationId, integration.id);
  });
});
