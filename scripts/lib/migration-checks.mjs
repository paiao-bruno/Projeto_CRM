/**
 * Verificações de migrations em camadas (cada uma reporta seu próprio resultado):
 *  1. estática: lock, pastas, SQL presente, baseline `_init`
 *  2. `prisma validate` (sintaxe/configuração do schema)
 *  3. histórico completo aplicado em banco vazio (`migrate deploy`) + tabela _prisma_migrations coerente
 *  4. divergência: migrations×schema (shadow distinto) e banco migrado×schema, com `--exit-code`
 *  5. atualização a partir do estado anterior à migration Vértice, com dados sintéticos preservados
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import {
  HarnessError,
  migrateDeploy,
  prismaEnv,
  repoRoot,
  runPrisma,
} from "./test-db-harness.mjs";

export const migrationsDir = join(repoRoot, "prisma/migrations");
export const defaultSchema = join(repoRoot, "prisma/schema.prisma");
const UPGRADE_BOUNDARY = "20261028120000_vertice_inbox_core";

export function listMigrations(dir = migrationsDir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function checkStatic(dir = migrationsDir) {
  if (!existsSync(join(dir, "migration_lock.toml"))) throw new HarnessError("migration_lock.toml ausente.", "STATIC");
  const folders = listMigrations(dir);
  if (folders.length === 0) throw new HarnessError("Nenhuma migration encontrada.", "STATIC");
  for (const folder of folders) {
    const file = join(dir, folder, "migration.sql");
    if (!existsSync(file)) throw new HarnessError(`Migration ${folder} sem migration.sql.`, "STATIC");
    if (readFileSync(file, "utf8").includes("Loaded Prisma config")) {
      throw new HarnessError(`Migration ${folder} contém saída do CLI Prisma.`, "STATIC");
    }
  }
  if (!folders.some((folder) => folder.endsWith("_init"))) throw new HarnessError("Baseline *_init ausente.", "STATIC");
  return folders;
}

export function checkSchemaSyntax(schema = defaultSchema) {
  const run = runPrisma(["validate", "--schema", schema], { capture: true });
  if (run.status !== 0) throw new HarnessError(`prisma validate falhou:\n${run.stdout}\n${run.stderr}`, "SCHEMA_INVALID");
}

export async function checkAppliedHistory(ctx, expectedFolders) {
  const client = new Client({ connectionString: ctx.databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      'SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations" ORDER BY migration_name',
    );
    const names = rows.map((row) => row.migration_name);
    if (JSON.stringify(names) !== JSON.stringify(expectedFolders)) {
      throw new HarnessError(`Histórico aplicado difere das pastas.\naplicado=${names.join(",")}\nesperado=${expectedFolders.join(",")}`, "HISTORY");
    }
    if (rows.some((row) => !row.finished || row.rolled_back)) {
      throw new HarnessError("Há migration não finalizada ou revertida em _prisma_migrations.", "HISTORY");
    }
  } finally {
    await client.end();
  }
}

/**
 * `migrate diff --exit-code`: 0 = sem diferenças, 2 = diferenças, outro = erro.
 * from: "migrations" usa o shadow database (distinto do banco principal); "database" usa o banco migrado.
 */
export function diffAgainstSchema(ctx, { from, schema = defaultSchema }) {
  if (from === "migrations" && (!ctx.shadowUrl || ctx.shadowUrl === ctx.databaseUrl)) {
    throw new HarnessError("Comparação migrations×schema exige shadow database distinto do banco principal.", "DRIFT");
  }
  const fromArgs = from === "migrations" ? ["--from-migrations", "prisma/migrations"] : ["--from-config-datasource"];
  const run = runPrisma(["migrate", "diff", ...fromArgs, "--to-schema", schema, "--exit-code"], {
    env: prismaEnv(ctx),
    capture: true,
  });
  return { exitCode: run.status, output: `${run.stdout}\n${run.stderr}`.trim() };
}

export function assertNoDrift(ctx, options) {
  const { exitCode, output } = diffAgainstSchema(ctx, options);
  if (exitCode === 0) return;
  if (exitCode === 2) {
    throw new HarnessError(`Divergência detectada (${options.from}×schema):\n${output.slice(0, 1500)}`, "DRIFT");
  }
  throw new HarnessError(`migrate diff falhou (exit ${exitCode}):\n${output.slice(0, 1500)}`, "DRIFT_ERROR");
}

async function exec(client, sql, params) {
  return client.query(sql, params);
}

/** Dados sintéticos no esquema ANTERIOR à migration Vértice (somente SQL; sem Prisma Client). */
async function seedLegacyData(client) {
  const t = await exec(client, `INSERT INTO "Tenant" (id, name, slug, status, "updatedAt") VALUES (gen_random_uuid(), 'Org Legada Sintetica', 'org-legada-sintetica', 'ACTIVE', now()) RETURNING id`);
  const tenantId = t.rows[0].id;
  const c = await exec(client, `INSERT INTO "Customer" (id, "tenantId", name, phone, "ispAccountCode", status, "updatedAt") VALUES (gen_random_uuid(), $1, 'Cliente Historico', '5511900000001', 'LEGACY-1', 'ACTIVE', now()) RETURNING id`, [tenantId]);
  const customerId = c.rows[0].id;
  const ct = await exec(client, `INSERT INTO "Contract" (id, "tenantId", "customerId", "externalId", status, "planName", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'EXT-C-1', 'ACTIVE', 'Plano 300', now()) RETURNING id`, [tenantId, customerId]);
  const contractId = ct.rows[0].id;
  await exec(client, `INSERT INTO "Invoice" (id, "tenantId", "customerId", "contractId", "externalId", status, "amountCents", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, 'EXT-I-1', 'OPEN', 12990, now())`, [tenantId, customerId, contractId]);
  const cv = await exec(client, `INSERT INTO "Conversation" (id, "tenantId", "customerId", status, "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'OPEN', now()) RETURNING id`, [tenantId, customerId]);
  await exec(client, `INSERT INTO "Message" (id, "tenantId", "conversationId", "senderType", direction, "contentType", body) VALUES (gen_random_uuid(), $1, $2, 'CUSTOMER', 'INBOUND', 'TEXT', 'mensagem historica')`, [tenantId, cv.rows[0].id]);
  return { tenantId, customerId, contractId, conversationId: cv.rows[0].id };
}

export async function checkUpgradeFromLegacy(ctx) {
  const folders = listMigrations();
  const boundary = folders.indexOf(UPGRADE_BOUNDARY);
  if (boundary < 1) throw new HarnessError(`Migration de fronteira ${UPGRADE_BOUNDARY} não encontrada.`, "UPGRADE");
  const baseline = folders.slice(0, boundary);

  const client = new Client({ connectionString: ctx.databaseUrl });
  await client.connect();
  let seeded;
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await client.query('CREATE EXTENSION IF NOT EXISTS "vector"');
    for (const folder of baseline) {
      await client.query(readFileSync(join(migrationsDir, folder, "migration.sql"), "utf8"));
    }
    seeded = await seedLegacyData(client);
  } finally {
    await client.end();
  }

  for (const folder of baseline) {
    const run = runPrisma(["migrate", "resolve", "--applied", folder, "--schema", "prisma/schema.prisma"], {
      env: prismaEnv(ctx),
      capture: true,
    });
    if (run.status !== 0) throw new HarnessError(`migrate resolve ${folder} falhou:\n${run.stdout}\n${run.stderr}`, "UPGRADE");
  }
  migrateDeploy(ctx);
  await checkAppliedHistory(ctx, folders);

  const after = new Client({ connectionString: ctx.databaseUrl });
  await after.connect();
  try {
    const inv = await after.query(`SELECT "externalId", "amountCents", "contractId" FROM "Invoice" WHERE "tenantId" = $1`, [seeded.tenantId]);
    const con = await after.query(`SELECT "externalId", "customerId" FROM "Contract" WHERE id = $1`, [seeded.contractId]);
    const cust = await after.query(`SELECT "ispAccountCode" FROM "Customer" WHERE id = $1`, [seeded.customerId]);
    const conv = await after.query(`SELECT protocol, version, "unreadCount" FROM "Conversation" WHERE id = $1`, [seeded.conversationId]);
    const msgs = await after.query(`SELECT count(*)::int AS n FROM "Message" WHERE "conversationId" = $1`, [seeded.conversationId]);
    const checks = [
      [inv.rows.length === 1 && inv.rows[0].externalId === "EXT-I-1" && inv.rows[0].amountCents === 12990, "fatura histórica preservada (ID externo e valor)"],
      [inv.rows[0]?.contractId === seeded.contractId, "vínculo fatura→contrato preservado"],
      [con.rows[0]?.externalId === "EXT-C-1" && con.rows[0]?.customerId === seeded.customerId, "contrato histórico preservado com vínculo ao cliente"],
      [cust.rows[0]?.ispAccountCode === "LEGACY-1", "ID externo do cliente preservado"],
      [conv.rows[0]?.protocol === null && conv.rows[0]?.version === 1 && conv.rows[0]?.unreadCount === 0, "conversa histórica recebeu defaults (protocol nulo, version 1)"],
      [msgs.rows[0].n === 1, "mensagem histórica preservada"],
    ];
    const failed = checks.filter(([ok]) => !ok).map(([, label]) => label);
    if (failed.length > 0) throw new HarnessError(`Atualização perdeu/alterou dados: ${failed.join("; ")}`, "UPGRADE");
    return checks.map(([, label]) => label);
  } finally {
    await after.end();
  }
}
