import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  decryptJsonWithKey,
  encryptJsonWithKey,
  validateDecryptedSecrets,
} from "./encryption.mjs";

export const MIN_NODE_MAJOR = 20;
export const DRY_RUN_PROOF_TTL_MS = 15 * 60 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    skipDryRunProof: env.REENCRYPT_SKIP_DRY_RUN_PROOF === "I_ACCEPT_THE_RISK",
    dryRunProof: env.REENCRYPT_DRY_RUN_PROOF?.trim() ?? "",
    backupDir: env.REENCRYPT_BACKUP_DIR?.trim() ?? "",
    nodeEnv: env.NODE_ENV ?? "",
  };
}

export function isValidUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export function maskDatabaseUrl(databaseUrl) {
  if (!databaseUrl) return null;
  return databaseUrl.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:***@");
}

export function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl || typeof databaseUrl !== "string") {
    return null;
  }
  try {
    const parsed = new URL(databaseUrl);
    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      database: parsed.pathname.replace(/^\//, "").split("?")[0] || "",
      username: decodeURIComponent(parsed.username || ""),
      password: decodeURIComponent(parsed.password || ""),
    };
  } catch {
    return null;
  }
}

export function analyzeDatabaseUrl(databaseUrl) {
  const parsed = parseDatabaseUrl(databaseUrl);
  if (!parsed) {
    return {
      present: Boolean(databaseUrl),
      protocolOk: false,
      passwordIsString: false,
      hostnamePresent: false,
      databasePresent: false,
    };
  }
  return {
    present: true,
    protocolOk: parsed.protocol === "postgresql:" || parsed.protocol === "postgres:",
    passwordIsString: typeof parsed.password === "string",
    hostnamePresent: Boolean(parsed.hostname),
    databasePresent: Boolean(parsed.database),
    maskedUrl: maskDatabaseUrl(databaseUrl),
  };
}

export function assertDatabaseUrlReadyForPg(databaseUrl) {
  const analysis = analyzeDatabaseUrl(databaseUrl);
  const problems = [];
  if (!analysis.present) problems.push("DATABASE_URL");
  if (!analysis.protocolOk) problems.push("DATABASE_URL(protocolo inválido)");
  if (!analysis.hostnamePresent) problems.push("DATABASE_URL(host ausente)");
  if (!analysis.databasePresent) problems.push("DATABASE_URL(banco ausente)");
  if (!analysis.passwordIsString) problems.push("DATABASE_URL(senha inválida)");
  if (problems.length > 0) {
    throw new Error(
      `Variáveis obrigatórias ausentes ou inválidas: ${problems.join(", ")}`,
    );
  }
}

export function sanitizePgConnectError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("client password must be a string")) {
    return "DATABASE_URL inválida: senha ausente ou inválida para autenticação SASL.";
  }
  if (message.includes("password authentication failed")) {
    return "Falha de autenticação PostgreSQL (credenciais rejeitadas).";
  }
  return message.replace(
    /:\/\/([^:@/]+):([^@/]+)@/g,
    "://$1:***@",
  );
}

export function isNodeVersionSupported(version = process.versions.node) {
  const major = Number.parseInt(String(version).split(".")[0] ?? "0", 10);
  return Number.isFinite(major) && major >= MIN_NODE_MAJOR;
}

export function validateFlagCombination(args) {
  const errors = [];
  if (args.preflight && args.write) {
    errors.push("--preflight não pode ser combinado com --execute.");
  }
  if (args.preflight && args.restore) {
    errors.push("--preflight com --restore exige apenas validação estática.");
  }
  if (args.restore && args.write && !args.backupFile) {
    errors.push("--restore --execute exige --backup-file.");
  }
  if (args.execute && args.dryRunExplicit && !args.write) {
    errors.push("Combinação inválida de flags --dry-run e --execute.");
  }
  return errors;
}

export function collectReencryptValidationErrors(config, { mode, args = {} }) {
  const missing = [];
  const errors = [];

  if (!config.databaseUrl) missing.push("DATABASE_URL");

  const db = analyzeDatabaseUrl(config.databaseUrl);
  if (config.databaseUrl && !db.protocolOk) {
    errors.push("DATABASE_URL deve usar protocolo postgresql:// ou postgres://.");
  }
  if (config.databaseUrl && db.present && !db.passwordIsString) {
    errors.push("DATABASE_URL deve conter senha do tipo string (mesmo que vazia).");
  }

  if (!config.tenantId) missing.push("REENCRYPT_TENANT_ID");
  else if (!isValidUuid(config.tenantId)) errors.push("REENCRYPT_TENANT_ID deve ser UUID válido.");

  if (!config.integrationId) missing.push("REENCRYPT_INTEGRATION_ID");
  else if (!isValidUuid(config.integrationId)) {
    errors.push("REENCRYPT_INTEGRATION_ID deve ser UUID válido.");
  }

  if (!config.confirmId) missing.push("REENCRYPT_CONFIRM_ID");
  else if (!isValidUuid(config.confirmId)) errors.push("REENCRYPT_CONFIRM_ID deve ser UUID válido.");

  if (config.integrationId && config.confirmId && config.integrationId !== config.confirmId) {
    errors.push("REENCRYPT_CONFIRM_ID deve ser idêntico a REENCRYPT_INTEGRATION_ID.");
  }

  if (mode === "reencrypt") {
    if (!config.encryptionKey) missing.push("ENCRYPTION_KEY");
    else if (config.encryptionKey.length < 32) {
      errors.push("ENCRYPTION_KEY deve ter ao menos 32 caracteres.");
    }
    if (!config.sgpApp) missing.push("SGP_APP");
    if (!config.sgpToken) missing.push("SGP_TOKEN");
  }

  if (mode === "restore") {
    if (!config.encryptionKey) missing.push("ENCRYPTION_KEY");
    else if (config.encryptionKey.length < 32) {
      errors.push("ENCRYPTION_KEY deve ter ao menos 32 caracteres.");
    }
  }

  if (config.nodeEnv === "production" && !config.allowProduction) {
    errors.push(
      "NODE_ENV=production bloqueado. Defina REENCRYPT_ALLOW_PRODUCTION=I_UNDERSTAND_THE_RISK.",
    );
  }

  errors.push(...validateFlagCombination(args));

  return {
    missing,
    errors,
    ok: missing.length === 0 && errors.length === 0,
  };
}

export function resolveBackupDirectory(config, rootDir) {
  return config.backupDir
    ? path.resolve(config.backupDir)
    : path.resolve(rootDir, "..", "isp-crm-integration-backups");
}

export function checkBackupDirectoryWritable(config, rootDir) {
  const directory = resolveBackupDirectory(config, rootDir);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const probe = path.join(directory, `.write-test-${randomUUID()}`);
  fs.writeFileSync(probe, "ok", { mode: 0o600 });
  fs.unlinkSync(probe);
  return { directory, writable: true };
}

export function runPreflight(config, args, rootDir) {
  const mode = args.restore ? "restore" : "reencrypt";
  const validation = collectReencryptValidationErrors(config, { mode, args });
  const db = analyzeDatabaseUrl(config.databaseUrl);
  let backup = { writable: false, directory: resolveBackupDirectory(config, rootDir) };

  try {
    backup = checkBackupDirectoryWritable(config, rootDir);
  } catch (error) {
    validation.errors.push(
      `Diretório de backup não gravável: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const checks = {
    nodeVersionOk: isNodeVersionSupported(),
    databaseUrlPresent: db.present,
    databaseUrlProtocolOk: db.protocolOk,
    databasePasswordIsString: db.passwordIsString,
    encryptionKeyPresent: Boolean(config.encryptionKey),
    encryptionKeyLengthOk: config.encryptionKey.length >= 32,
    sgpAppPresent: Boolean(config.sgpApp),
    sgpTokenPresent: Boolean(config.sgpToken),
    tenantIdUuidOk: isValidUuid(config.tenantId),
    integrationIdUuidOk: isValidUuid(config.integrationId),
    confirmIdMatchesIntegrationId:
      Boolean(config.integrationId) &&
      config.integrationId === config.confirmId,
    flagsCompatible: validateFlagCombination(args).length === 0,
    productionBlockedUnlessConfirmed:
      config.nodeEnv !== "production" || config.allowProduction,
    backupDirectoryWritable: backup.writable,
  };

  const ok =
    validation.ok &&
    checks.nodeVersionOk &&
    checks.backupDirectoryWritable &&
    (mode === "restore" || (checks.sgpAppPresent && checks.sgpTokenPresent));

  return {
    mode: "preflight",
    ok,
    operationMode: mode,
    nodeVersion: process.version,
    checks,
    missing: validation.missing,
    errors: validation.errors,
    masked: {
      databaseUrl: db.maskedUrl ?? null,
      backupDirectory: backup.directory,
    },
    connectsToDatabase: false,
    readsIntegration: false,
    writesBackup: false,
    runsTransaction: false,
  };
}

export function createDryRunProof({
  integrationId,
  tenantId,
  integrityChecksums,
  encryptedSecretsHash,
  issuedAt = Date.now(),
}) {
  const expiresAt = issuedAt + DRY_RUN_PROOF_TTL_MS;
  const proofId = hashText(
    [
      integrationId,
      tenantId,
      JSON.stringify(integrityChecksums),
      encryptedSecretsHash ?? "null",
      String(issuedAt),
    ].join("|"),
  );
  return {
    proofId,
    issuedAt,
    expiresAt,
    integrationId,
    tenantId,
  };
}

export function encodeDryRunProofToken(proof) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      proofId: proof.proofId,
      issuedAt: proof.issuedAt,
      expiresAt: proof.expiresAt,
      integrationId: proof.integrationId,
      tenantId: proof.tenantId,
    }),
  ).toString("base64url");
}

export function decodeDryRunProofToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("REENCRYPT_DRY_RUN_PROOF ausente ou inválido.");
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    throw new Error("REENCRYPT_DRY_RUN_PROOF inválido: token corrompido.");
  }
  if (
    parsed?.v !== 1 ||
    !parsed.proofId ||
    !parsed.integrationId ||
    !parsed.tenantId ||
    !parsed.issuedAt ||
    !parsed.expiresAt
  ) {
    throw new Error("REENCRYPT_DRY_RUN_PROOF inválido: estrutura incompleta.");
  }
  return parsed;
}

export async function fetchIntegrationFingerprint(client, tenantId, integrationId) {
  const integrity = await collectTenantIntegrity(client, tenantId);
  const result = await client.query(
    `SELECT "encryptedSecrets"
     FROM "Integration"
     WHERE "tenantId" = $1 AND id = $2 AND provider = 'SGP'`,
    [tenantId, integrationId],
  );
  if (result.rows.length !== 1) {
    throw new Error("Integração SGP não encontrada para verificação do comprovante.");
  }
  const encryptedSecrets = result.rows[0].encryptedSecrets;
  return {
    integrityChecksums: integrity.checksums,
    encryptedSecretsHash: encryptedSecrets ? hashText(encryptedSecrets) : null,
  };
}

export async function verifyDryRunProofForExecute(client, config, token) {
  const decoded = decodeDryRunProofToken(token);
  if (decoded.integrationId !== config.integrationId || decoded.tenantId !== config.tenantId) {
    throw new Error("Comprovante de dry-run não corresponde aos IDs informados.");
  }
  if (Date.now() > decoded.expiresAt) {
    throw new Error("Comprovante de dry-run expirado. Execute dry-run novamente.");
  }

  const fingerprint = await fetchIntegrationFingerprint(
    client,
    config.tenantId,
    config.integrationId,
  );
  const expected = createDryRunProof({
    integrationId: decoded.integrationId,
    tenantId: decoded.tenantId,
    integrityChecksums: fingerprint.integrityChecksums,
    encryptedSecretsHash: fingerprint.encryptedSecretsHash,
    issuedAt: decoded.issuedAt,
  });

  if (expected.proofId !== decoded.proofId) {
    throw new Error(
      "Comprovante de dry-run inválido: banco alterado desde o dry-run ou token corrompido.",
    );
  }

  return {
    valid: true,
    expiresAt: new Date(decoded.expiresAt).toISOString(),
    proofId: decoded.proofId,
  };
}

export function formatValidationFailure(validation) {
  const parts = [];
  if (validation.missing.length > 0) {
    parts.push(`Variáveis obrigatórias ausentes: ${validation.missing.join(", ")}`);
  }
  if (validation.errors.length > 0) {
    parts.push(...validation.errors);
  }
  return parts.join("\n");
}

export function validateReencryptEnv(config, { mode, args = {} }) {
  const validation = collectReencryptValidationErrors(config, { mode, args });
  if (!validation.ok) {
    throw new Error(formatValidationFailure(validation));
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

  validateReencryptEnv(config, { mode, args: options.args ?? {} });

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

    if (!write && mode === "reencrypt") {
      const proof = createDryRunProof({
        integrationId: integration.id,
        tenantId: config.tenantId,
        integrityChecksums: beforeIntegrity.checksums,
        encryptedSecretsHash: report.encryptedSecrets.previousHash,
      });
      report.dryRunProof = {
        token: encodeDryRunProofToken(proof),
        expiresAt: new Date(proof.expiresAt).toISOString(),
        proofId: proof.proofId,
        integrationId: proof.integrationId,
        tenantId: proof.tenantId,
      };
      report.executeInstructions =
        "Defina REENCRYPT_DRY_RUN_PROOF com o token retornado antes de executar --execute.";
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
