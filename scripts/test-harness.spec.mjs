/**
 * Testes do harness e dos scripts de validação (inclui controles negativos).
 * Os casos que dependem de PostgreSQL FALHAM (não são pulados) se TEST_DATABASE_ADMIN_URL faltar.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Client } from "pg";
import {
  createOwnedDatabase,
  dropOwnedDatabase,
  newRunId,
  readAdminUrl,
  repoRoot,
  withDisposableDatabases,
} from "./lib/test-db-harness.mjs";
import { defaultSchema, diffAgainstSchema, migrationsDir } from "./lib/migration-checks.mjs";
import { migrateDeploy } from "./lib/test-db-harness.mjs";

function runScript(script, env, args = []) {
  const clean = { ...process.env };
  delete clean.TEST_DATABASE_ADMIN_URL;
  delete clean.DATABASE_URL;
  const result = spawnSync(process.execPath, [join(repoRoot, script), ...args], {
    cwd: repoRoot,
    env: { ...clean, ...env },
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: result.status, out: `${result.stdout}\n${result.stderr}` };
}

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;

function requireDb() {
  assert.ok(adminUrl, "TEST_DATABASE_ADMIN_URL é obrigatória para este caso (não é pulado).");
}

describe("harness: pré-requisitos e recusas (sem tocar dados)", () => {
  it("sem TEST_DATABASE_ADMIN_URL: falha com instrução de preparação e exit != 0", () => {
    const run = runScript("scripts/validate-prisma.mjs", {});
    assert.notEqual(run.status, 0);
    assert.match(run.out, /TEST_DATABASE_ADMIN_URL não definida/);
  });

  it("sem TEST_DATABASE_ADMIN_URL: o teste do Funil também falha (não usa banco da aplicação)", () => {
    const run = runScript("scripts/test-sales-funnel-integration.mjs", { DATABASE_URL: "postgresql://crm:crm@localhost:5432/isp_crm" });
    assert.notEqual(run.status, 0);
    assert.match(run.out, /MISSING_ADMIN_URL/);
  });

  it("host remoto é recusado antes de conectar", () => {
    assert.throws(() => readAdminUrl({ TEST_DATABASE_ADMIN_URL: "postgresql://u:p@db.exemplo.com:5432/postgres" }), /não é local/);
  });

  it("banco da aplicação como destino administrativo é recusado", () => {
    for (const db of ["isp_crm", "isp_crm_shadow", "vtest_abc123"]) {
      assert.throws(
        () => readAdminUrl({ TEST_DATABASE_ADMIN_URL: `postgresql://u:p@localhost:5432/${db}` }),
        /banco de manutenção/,
      );
    }
  });

  it("banco indisponível (porta fechada, inclusive diferente de 5432) falha dentro do limite", () => {
    const started = Date.now();
    const run = runScript(
      "scripts/validate-prisma.mjs",
      { TEST_DATABASE_ADMIN_URL: "postgresql://u:p@127.0.0.1:1/postgres", TEST_DATABASE_READY_TIMEOUT_MS: "1500" },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.out, /DB_UNAVAILABLE/);
    assert.match(run.out, /127\.0\.0\.1:1/);
    assert.ok(Date.now() - started < 60_000);
  });

  it("--static-only declara explicitamente o que NÃO foi verificado", () => {
    const run = runScript("scripts/validate-prisma.mjs", {}, ["--static-only"]);
    assert.equal(run.status, 0, run.out);
    assert.match(run.out, /NÃO VERIFICADO/);
  });
});

describe("harness: execução real em PostgreSQL", () => {
  it("cria bancos exclusivos, aplica migrations e limpa tudo ao final", async () => {
    requireDb();
    let name;
    await withDisposableDatabases({ shadow: true }, async (ctx) => {
      name = ctx.databaseName;
      assert.notEqual(ctx.databaseUrl, ctx.shadowUrl);
      assert.match(ctx.databaseName, /^vtest_[a-z0-9]+$/);
      migrateDeploy(ctx);
    });
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    const left = await admin.query("SELECT datname FROM pg_database WHERE datname LIKE $1", [`${name}%`]);
    await admin.end();
    assert.equal(left.rowCount, 0, "bancos da execução devem ser removidos");
  });

  it("limpeza roda mesmo quando o teste falha e preserva o erro original", async () => {
    requireDb();
    let name;
    await assert.rejects(
      withDisposableDatabases({}, async (ctx) => {
        name = ctx.databaseName;
        throw new Error("falha-original");
      }),
      /falha-original/,
    );
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    const left = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    await admin.end();
    assert.equal(left.rowCount, 0);
  });

  it("recusa remover banco cujo marcador de propriedade pertence a outra execução", async () => {
    requireDb();
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    const foreignRun = newRunId();
    const name = `vtest_${foreignRun}`;
    try {
      await createOwnedDatabase(admin, name, foreignRun);
      await assert.rejects(dropOwnedDatabase(admin, name, newRunId()), /marcador de propriedade/);
      const still = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      assert.equal(still.rowCount, 1, "banco de outra execução não pode ser apagado");
    } finally {
      await dropOwnedDatabase(admin, name, foreignRun);
      await admin.end();
    }
  });

  it("recusa nomes fora do padrão de teste (ex.: banco da aplicação)", async () => {
    requireDb();
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await assert.rejects(dropOwnedDatabase(admin, "isp_crm", newRunId()), /fora do padrão/);
      await assert.rejects(dropOwnedDatabase(admin, "postgres", newRunId()), /fora do padrão/);
    } finally {
      await admin.end();
    }
  });

  it("controle negativo: asserção do Funil que falha devolve exit code != 0 e não deixa bancos", () => {
    requireDb();
    const run = runScript("scripts/test-sales-funnel-integration.mjs", { TEST_DATABASE_ADMIN_URL: adminUrl, TEST_NEGATIVE_CONTROL: "1" });
    assert.notEqual(run.status, 0);
    assert.match(run.out, /oportunidades ganhas/);
  });

  it("detecta divergência entre migrations e schema (exit code 2) e aceita o schema real", async () => {
    requireDb();
    const dir = mkdtempSync(join(tmpdir(), "vtest-schema-"));
    const driftSchema = join(dir, "schema.prisma");
    copyFileSync(defaultSchema, driftSchema);
    writeFileSync(driftSchema, `${readFileSync(driftSchema, "utf8")}\nmodel DriftProbe {\n  id String @id\n}\n`);
    await withDisposableDatabases({ shadow: true }, async (ctx) => {
      migrateDeploy(ctx);
      assert.equal(diffAgainstSchema(ctx, { from: "migrations" }).exitCode, 0);
      assert.equal(diffAgainstSchema(ctx, { from: "database" }).exitCode, 0);
      assert.equal(diffAgainstSchema(ctx, { from: "migrations", schema: driftSchema }).exitCode, 2);
      assert.equal(diffAgainstSchema(ctx, { from: "database", schema: driftSchema }).exitCode, 2);
    });
  });

  it("migrations×schema exige shadow distinto do banco principal", async () => {
    requireDb();
    await withDisposableDatabases({}, async (ctx) => {
      assert.throws(() => diffAgainstSchema(ctx, { from: "migrations" }), /shadow database distinto/);
    });
  });

  it("migrations já aplicadas não são alteradas (checksum registrado confere com o arquivo)", async () => {
    requireDb();
    const { createHash } = await import("node:crypto");
    const { readdirSync } = await import("node:fs");
    await withDisposableDatabases({}, async (ctx) => {
      migrateDeploy(ctx);
      const client = new Client({ connectionString: ctx.databaseUrl });
      await client.connect();
      const { rows } = await client.query('SELECT migration_name, checksum FROM "_prisma_migrations"');
      await client.end();
      for (const row of rows) {
        const sql = readFileSync(join(migrationsDir, row.migration_name, "migration.sql"));
        assert.equal(row.checksum, createHash("sha256").update(sql).digest("hex"), row.migration_name);
      }
      assert.equal(rows.length, readdirSync(migrationsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length);
    });
  });
});
