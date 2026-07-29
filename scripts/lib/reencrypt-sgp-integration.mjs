import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  decryptJsonWithKey,
  encryptJsonWithKey,
  validateDecryptedSecrets,
} from "./encryption.mjs";

const FORBIDDEN_UPDATE_COLUMNS = new Set([
  "id",
  "tenantId",
  "provider",
  "name",
  "status",
  "healthStatus",
  "config",
  "lastConnectedAt",
  "lastError",
  "createdAt",
  "updatedAt",
]);

export function readReencryptEnv(env = process.env) {
  return {
    databaseUrl: env.DATABASE_URL ?? "",
    encryptionKey: env.ENCRYPTION_KEY ?? "",
    sgpApp: env.SGP_APP?.trim() ?? "",
    sgpToken: env.SGP_TOKEN?.trim() ?? "",
    tenantId: env.REENCRYPT_TENANT_ID?.trim() ?? "",
    integrationId: env.REENCRYPT_INTEGRATION_ID?.trim() ?? "",
    confirmId: env.REENCRYPT_CONFIRM_ID?.trim() ?? "",
    allowProduction: env.REENCRYPT_ALLOW_PRODUCTION === "I_UNDERSTAND_THE_RISK",
    backupDir: env.REENCRYPT_BACKUP_DIR?.trim() ?? "",
    nodeEnv: env.NODE_ENV ?? "",
  };
}

export function validateReencryptEnv(config, { mode }) {
  const missing = [];
  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.tenantId) missing.push("REENCRYPT_TENANT_ID");
  if (!config.integrationId) missing.push("REENCRYPT_INTEGRATION_ID");
  if (!config.confirmId) missing.push("REENCRYPT_CONFIRM_ID");

  if (mode === "reencrypt") {
    if (!config.encryptionKey) missing.push("ENCRYPTION_KEY");
    if (!config.sgpApp) missing.push("SGP_APP");
    if (!config.sgpToken) missing.push("SGP_TOKEN");
  }

  if (mode === "restore") {
    if (!config.encryptionKey) missing.push("ENCRYPTION_KEY");
  }

  if (missing.length > 0) {
    throw new Error(`Variáveis obrigatórias ausentes: ${missing.join(", ")}`);
  }

  if (config.integrationId !== config.confirmId) {
    throw new Error("REENCRYPT_CONFIRM_ID deve ser idêntico a REENCRYPT_INTEGRATION_ID.");
  }

  if (config.nodeEnv === "production" && !config.allowProduction) {
    throw new Error(
      "Abortado: NODE_ENV=production. Defina REENCRYPT_ALLOW_PRODUCTION=I_UNDERSTAND_THE_RISK para continuar.",
    );
  }
}

export function hashText(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function hashIdSet(ids) {
  return hashText(ids.slice().sort().join("|"));
}

export function sanitizeIntegrationView(row) {
  const config = parseConfig(row.config);
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    provider: row.provider,
    status: row.status,
    healthStatus: row.healthStatus,
    apiUrl: config.apiUrl ?? null,
    apiPort: config.apiPort ?? null,
    timeoutMs: config.timeoutMs ?? null,
    encryptedSecretsPresent: Boolean(row.encryptedSecrets),
    encryptedSecretsHash: row.encryptedSecrets ? hashText(row.encryptedSecrets) : null,
    lastConnectedAt: row.lastConnectedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function parseConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {};
  }
  const record = config;
  return {
    apiUrl: typeof record.apiUrl === "string" ? record.apiUrl : undefined,
    apiPort: typeof record.apiPort === "string" ? record.apiPort : undefined,
    timeoutMs: typeof record.timeoutMs === "number" ? record.timeoutMs : undefined,
  };
}

export function buildBackupSnapshot(integrationRow, meta = {}) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    purpose: meta.purpose ?? "integration-encrypted-secrets-backup",
    tenantId: integrationRow.tenantId,
    integrationId: integrationRow.id,
    integration: {
      id: integrationRow.id,
      tenantId: integrationRow.tenantId,
      provider: integrationRow.provider,
      name: integrationRow.name,
      status: integrationRow.status,
      healthStatus: integrationRow.healthStatus,
      config: integrationRow.config,
      encryptedSecrets: integrationRow.encryptedSecrets,
      lastConnectedAt: integrationRow.lastConnectedAt,
      lastError: integrationRow.lastError,
      createdAt: integrationRow.createdAt,
      updatedAt: integrationRow.updatedAt,
    },
    encryptedSecretsHash: integrationRow.encryptedSecrets
      ? hashText(integrationRow.encryptedSecrets)
      : null,
    operatorNote:
      "Backup restaurável do ciphertext exato. Não commitar. Não compartilhar.",
  };
}

export function resolveBackupPath(config, integrationId, rootDir) {
  const baseDir = config.backupDir
    ? path.resolve(config.backupDir)
    : path.resolve(rootDir, "..", "isp-crm-integration-backups");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(baseDir, `integration-${integrationId}-${timestamp}.json`);
}

export function writeBackupFile(filePath, snapshot) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows pode ignorar chmod; permissão de criação já foi definida.
  }
  return filePath;
}

export function readBackupFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed?.integration?.encryptedSecrets) {
    throw new Error("Arquivo de backup inválido: encryptedSecrets ausente.");
  }
  if (!parsed.integrationId || !parsed.tenantId) {
    throw new Error("Arquivo de backup inválido: metadados incompletos.");
  }
  return parsed;
}

export async function collectTenantIntegrity(client, tenantId) {
  const [customers, contracts, invoices, syncRuns, syncLogs, integrations] =
    await Promise.all([
      client.query(
        `SELECT id FROM "Customer" WHERE "tenantId" = $1 AND "deletedAt" IS NULL ORDER BY id`,
        [tenantId],
      ),
      client.query(
        `SELECT id FROM "Contract" WHERE "tenantId" = $1 AND "deletedAt" IS NULL ORDER BY id`,
        [tenantId],
      ),
      client.query(
        `SELECT id FROM "Invoice" WHERE "tenantId" = $1 AND "deletedAt" IS NULL ORDER BY id`,
        [tenantId],
      ),
      client.query(
        `SELECT id FROM "IntegrationSyncRun" WHERE "tenantId" = $1 ORDER BY id`,
        [tenantId],
      ),
      client.query(
        `SELECT id FROM "IntegrationSyncLog" WHERE "tenantId" = $1 ORDER BY id`,
        [tenantId],
      ),
      client.query(
        `SELECT id FROM "Integration" WHERE "tenantId" = $1 ORDER BY id`,
        [tenantId],
      ),
    ]);

  const customerIds = customers.rows.map((row) => row.id);
  const contractIds = contracts.rows.map((row) => row.id);
  const invoiceIds = invoices.rows.map((row) => row.id);
  const syncRunIds = syncRuns.rows.map((row) => row.id);
  const syncLogIds = syncLogs.rows.map((row) => row.id);
  const integrationIds = integrations.rows.map((row) => row.id);

  return {
    counts: {
      customers: customerIds.length,
      contracts: contractIds.length,
      invoices: invoiceIds.length,
      integrationSyncRuns: syncRunIds.length,
      integrationSyncLogs: syncLogIds.length,
      integrations: integrationIds.length,
    },
    checksums: {
      customers: hashIdSet(customerIds),
      contracts: hashIdSet(contractIds),
      invoices: hashIdSet(invoiceIds),
      integrationSyncRuns: hashIdSet(syncRunIds),
      integrationSyncLogs: hashIdSet(syncLogIds),
      integrations: hashIdSet(integrationIds),
    },
  };
}

export function assertIntegrityUnchanged(before, after) {
  for (const key of Object.keys(before.counts)) {
    if (before.counts[key] !== after.counts[key]) {
      throw new Error(
        `Integridade violada: contagem de ${key} alterada (${before.counts[key]} -> ${after.counts[key]}).`,
      );
    }
  }
  for (const key of Object.keys(before.checksums)) {
    if (before.checksums[key] !== after.checksums[key]) {
      throw new Error(`Integridade violada: checksum de ${key} alterado.`);
    }
  }
}

export function assertIntegrationColumnsUnchanged(beforeRow, afterRow) {
  const columns = [
    "id",
    "tenantId",
    "provider",
    "name",
    "status",
    "healthStatus",
    "config",
    "lastConnectedAt",
    "lastError",
    "createdAt",
    "updatedAt",
  ];

  for (const column of columns) {
    const beforeValue = normalizeComparable(beforeRow[column]);
    const afterValue = normalizeComparable(afterRow[column]);
    if (beforeValue !== afterValue) {
      throw new Error(`Integridade violada: Integration.${column} alterado.`);
    }
  }
}

function normalizeComparable(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  if (value === undefined) {
    return null;
  }
  return value;
}

export async function locateIntegrationForUpdate(client, tenantId, integrationId) {
  const result = await client.query(
    `SELECT *
     FROM "Integration"
     WHERE "tenantId" = $1
       AND provider = 'SGP'
       AND id = $2
     FOR UPDATE`,
    [tenantId, integrationId],
  );

  if (result.rows.length === 0) {
    throw new Error("Integração SGP não encontrada para tenantId + integrationId informados.");
  }
  if (result.rows.length > 1) {
    throw new Error("Mais de uma integração encontrada; operação abortada.");
  }

  return result.rows[0];
}

export function buildNextEncryptedSecrets(encryptionKey, sgpApp, sgpToken) {
  const nextEncryptedSecrets = encryptJsonWithKey(encryptionKey, {
    app: sgpApp,
    token: sgpToken,
  });
  validateDecryptedSecrets(decryptJsonWithKey(encryptionKey, nextEncryptedSecrets));
  return nextEncryptedSecrets;
}

export function validateBackupTarget(config, backup) {
  if (backup.tenantId !== config.tenantId) {
    throw new Error("Backup não pertence ao tenantId informado.");
  }
  if (backup.integrationId !== config.integrationId) {
    throw new Error("Backup não pertence ao integrationId informado.");
  }
}

export async function runReencryptOperation(client, options) {
  const {
    config,
    mode,
    write = false,
    backupFilePath = null,
    rootDir,
    injectFailureAfterUpdate = false,
  } = options;

  validateReencryptEnv(config, { mode });

  await client.query("BEGIN");

  try {
    const beforeIntegrity = await collectTenantIntegrity(client, config.tenantId);
    const integration = await locateIntegrationForUpdate(
      client,
      config.tenantId,
      config.integrationId,
    );
    const beforeRow = { ...integration };

    let nextEncryptedSecrets;
    let backupPath = null;
    let backupSnapshot = null;

    if (mode === "reencrypt") {
      nextEncryptedSecrets = buildNextEncryptedSecrets(
        config.encryptionKey,
        config.sgpApp,
        config.sgpToken,
      );
      backupSnapshot = buildBackupSnapshot(integration, { purpose: "pre-reencrypt-backup" });
    } else if (mode === "restore") {
      if (!backupFilePath) {
        throw new Error("Informe --backup-file para restauração.");
      }
      backupSnapshot = readBackupFile(backupFilePath);
      validateBackupTarget(config, backupSnapshot);
      nextEncryptedSecrets = backupSnapshot.integration.encryptedSecrets;
      validateDecryptedSecrets(decryptJsonWithKey(config.encryptionKey, nextEncryptedSecrets));
    } else {
      throw new Error(`Modo inválido: ${mode}`);
    }

    const report = {
      mode: write ? mode : `${mode}-dry-run`,
      integration: sanitizeIntegrationView(integration),
      encryptedSecrets: {
        previousPresent: Boolean(integration.encryptedSecrets),
        previousHash: integration.encryptedSecrets
          ? hashText(integration.encryptedSecrets)
          : null,
        nextHash: hashText(nextEncryptedSecrets),
        willChange:
          !integration.encryptedSecrets ||
          hashText(integration.encryptedSecrets) !== hashText(nextEncryptedSecrets),
      },
      integrity: {
        before: beforeIntegrity,
      },
      backupFile: null,
      write,
    };

    if (write) {
      if (mode === "reencrypt") {
        backupPath = resolveBackupPath(config, integration.id, rootDir);
        writeBackupFile(backupPath, backupSnapshot);
        report.backupFile = backupPath;
      }

      const updateResult = await client.query(
        `UPDATE "Integration"
         SET "encryptedSecrets" = $1
         WHERE id = $2 AND "tenantId" = $3 AND provider = 'SGP'`,
        [nextEncryptedSecrets, integration.id, config.tenantId],
      );

      if (updateResult.rowCount !== 1) {
        throw new Error("UPDATE não afetou exatamente uma linha.");
      }

      if (injectFailureAfterUpdate) {
        throw new Error("Falha simulada após UPDATE e antes do COMMIT.");
      }

      const afterIntegration = await locateIntegrationForUpdate(
        client,
        config.tenantId,
        config.integrationId,
      );
      assertIntegrationColumnsUnchanged(beforeRow, afterIntegration);

      const afterIntegrity = await collectTenantIntegrity(client, config.tenantId);
      assertIntegrityUnchanged(beforeIntegrity, afterIntegrity);

      report.integrity.after = afterIntegrity;
      report.integrationAfter = sanitizeIntegrationView(afterIntegration);

      await client.query("COMMIT");
    } else {
      report.integrity.after = beforeIntegrity;
      await client.query("ROLLBACK");
    }

    return report;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function assertOnlyEncryptedSecretsUpdated(updateSql) {
  const normalized = updateSql.replace(/\s+/g, " ").trim().toUpperCase();
  if (!normalized.startsWith("UPDATE \"INTEGRATION\" SET \"ENCRYPTEDSECRETS\" =")) {
    throw new Error("SQL de atualização fora do escopo permitido.");
  }
  for (const column of FORBIDDEN_UPDATE_COLUMNS) {
    if (normalized.includes(`"${column.toUpperCase()}"`)) {
      throw new Error(`Atualização proibida da coluna ${column}.`);
    }
  }
}

export function createTestId(prefix = "id") {
  return `${prefix}-${randomUUID()}`;
}
