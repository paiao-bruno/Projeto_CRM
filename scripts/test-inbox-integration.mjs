#!/usr/bin/env node
/**
 * Testes de integração da caixa de entrada contra PostgreSQL descartável.
 * Nunca toca o banco de desenvolvimento/produção: exige nome *_test/_e2e, host local e
 * ALLOW_DISPOSABLE_DB=true (guardas em scripts/lib/disposable-db.mjs).
 *
 * Variáveis:
 *   INBOX_TEST_ADMIN_URL  conexão administrativa para criar o banco (ex.: .../postgres)
 *   INBOX_TEST_DATABASE_URL  banco descartável (default: mesmo servidor, banco vertice_inbox_test)
 */
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { assertDisposableDatabase } from "./lib/disposable-db.mjs";
import { applyDisposableMigrations } from "./lib/apply-disposable-migrations.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const adminUrl = process.env.INBOX_TEST_ADMIN_URL ?? "postgresql://crm:crm@localhost:5432/postgres";
const targetUrl = process.env.INBOX_TEST_DATABASE_URL ?? (() => {
  const u = new URL(adminUrl);
  u.pathname = "/vertice_inbox_test";
  u.search = "?schema=public";
  return u.toString();
})();

process.env.ALLOW_DISPOSABLE_DB = "true";
const target = assertDisposableDatabase(targetUrl, { requireFlag: true });

const admin = new Client({ connectionString: adminUrl });
await admin.connect();
const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [target.database]);
if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${target.database}"`);
await admin.end();

const db = new Client({ connectionString: targetUrl });
await db.connect();
await db.query("DROP SCHEMA IF EXISTS public CASCADE");
await db.query("CREATE SCHEMA public");
await db.end();

await applyDisposableMigrations(targetUrl);

const result = spawnSync(
  process.execPath,
  ["--test", "-r", "ts-node/register", "src/server/inbox/inbox.integration.ts"],
  {
    cwd: join(root, "apps/web"),
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: targetUrl,
      TS_NODE_PROJECT: join(root, "apps/web/tsconfig.test.json"),
    },
  },
);
process.exit(result.status ?? 1);
