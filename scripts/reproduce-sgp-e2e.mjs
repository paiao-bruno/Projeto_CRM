#!/usr/bin/env node
/**
 * Reprodução E2E da sincronização SGP com evidências DB + API.
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import bcrypt from "bcryptjs";
import { Client } from "pg";

const ROOT = process.cwd();
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:51214/isp_crm?schema=public";
const API_URL = "http://127.0.0.1:4000/api";
const MOCK_SGP_PORT = Number(process.env.MOCK_SGP_PORT ?? 9090);
const MOCK_SGP_URL = `http://127.0.0.1:${MOCK_SGP_PORT}`;

const evidence = {
  startedAt: new Date().toISOString(),
  db: {},
  sync: {},
  api: {},
  verdict: {},
};

async function connectDb() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  return client;
}

async function resetAndSeed(client) {
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");

  const migrationsDir = path.join(ROOT, "prisma/migrations");
  for (const folder of fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()) {
    const sqlPath = path.join(migrationsDir, folder, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    let sql = fs.readFileSync(sqlPath, "utf8");
    sql = sql
      .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";?\s*/g, "")
      .replace(/CREATE EXTENSION IF NOT EXISTS "vector";?\s*/g, "")
      .replace(/vector\(1536\)/g, "TEXT");
    try {
      await client.query(sql);
    } catch (error) {
      if (!String(error).includes("already exists")) throw error;
    }
  }

  const passwordHash = await bcrypt.hash("admin123", 10);
  const tenant = await client.query(
    `INSERT INTO "Tenant" (id, name, slug, status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), 'Fibra Plus ISP', 'fibra-plus', 'ACTIVE', NOW(), NOW())
     RETURNING id`,
  );
  const tenantId = tenant.rows[0].id;

  const user = await client.query(
    `INSERT INTO "User" (id, email, name, "passwordHash", status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), 'admin@ispcrm.local', 'Admin ISP', $1, 'ACTIVE', NOW(), NOW())
     RETURNING id`,
    [passwordHash],
  );
  const userId = user.rows[0].id;

  const role = await client.query(
    `INSERT INTO "Role" (id, "tenantId", name, scope, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'Administrador', 'TENANT', NOW(), NOW())
     RETURNING id`,
    [tenantId],
  );
  const roleId = role.rows[0].id;

  for (const code of [
    "dashboard.read",
    "chat.read",
    "chat.reply",
    "chat.transfer",
    "ai_agents.manage",
    "crm.manage",
    "customers.manage",
  ]) {
    const permission = await client.query(
      `INSERT INTO "Permission" (id, code, description, "createdAt")
       VALUES (gen_random_uuid(), $1, $1, NOW())
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
       RETURNING id`,
      [code],
    );
    await client.query(
      `INSERT INTO "RolePermission" ("roleId", "permissionId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [roleId, permission.rows[0].id],
    );
  }

  await client.query(
    `INSERT INTO "TenantMember" (id, "tenantId", "userId", "roleId", status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE', NOW(), NOW())`,
    [tenantId, userId, roleId],
  );

  return tenantId;
}

async function resolveTenantId(client) {
  const result = await client.query(`SELECT id FROM "Tenant" ORDER BY "createdAt" ASC LIMIT 1`);
  if (!result.rows[0]?.id) {
    throw new Error("Nenhum tenant encontrado após seed.");
  }
  return result.rows[0].id;
}

async function dbCounts(client, tenantId) {
  const result = await client.query(
    `SELECT
      (SELECT COUNT(*)::int FROM "Customer" WHERE "tenantId"=$1 AND "deletedAt" IS NULL) AS customers,
      (SELECT COUNT(*)::int FROM "Customer" WHERE "tenantId"=$1 AND "deletedAt" IS NULL AND "ispAccountCode" IS NOT NULL) AS "sgpCustomers",
      (SELECT COUNT(*)::int FROM "Contract" WHERE "tenantId"=$1 AND "deletedAt" IS NULL) AS contracts,
      (SELECT COUNT(*)::int FROM "Invoice" WHERE "tenantId"=$1 AND "deletedAt" IS NULL) AS invoices`,
    [tenantId],
  );
  return result.rows[0];
}

async function waitFor(url, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return true;
    } catch {
      // retry
    }
    await wait(500);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function login() {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@ispcrm.local", password: "admin123" }),
  });
  if (!response.ok) throw new Error(`Login failed: ${response.status} ${await response.text()}`);
  return (await response.json()).accessToken;
}

async function createCredentials(token) {
  const response = await fetch(`${API_URL}/integrations/sgp/credentials`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "SGP E2E",
      apiUrl: MOCK_SGP_URL,
      app: "validation-app",
      token: "validation-token",
    }),
  });
  if (!response.ok) throw new Error(`Create credentials failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function triggerSync(token, credentialId) {
  const response = await fetch(`${API_URL}/integrations/sgp/sync-customers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      credentialId,
      full: true,
      pagination: { offset: 0, limit: 100 },
    }),
  });
  if (!response.ok) throw new Error(`Sync trigger failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function pollSync(token, runId) {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const response = await fetch(`${API_URL}/integrations/sgp/sync-runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const run = await response.json();
    if (run.status !== "RUNNING") return run;
    await wait(500);
  }
  throw new Error(`Sync ${runId} still RUNNING after 120s`);
}

async function fetchTotals(token) {
  const headers = { Authorization: `Bearer ${token}` };

  async function readTotal(path) {
    const response = await fetch(`${API_URL}${path}`, { headers });
    if (!response.ok) {
      throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
    }
    const body = await response.json();
    return body.total ?? body.data?.length ?? 0;
  }

  return {
    customers: await readTotal("/customers?page=1&limit=500"),
    contracts: await readTotal("/contracts?page=1&limit=500"),
    invoices: await readTotal("/invoices?page=1&limit=500"),
  };
}

function startMock() {
  return spawn("node", ["scripts/mock-sgp-server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_SGP_PORT: String(MOCK_SGP_PORT) },
    stdio: "ignore",
  });
}

async function restartApi() {
  try {
    execSync("fuser -k 4000/tcp 2>/dev/null || true", { stdio: "ignore" });
  } catch {
    // ignore
  }
  await wait(2000);

  const child = spawn("node", ["apps/api/dist/main.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL,
      AUTO_SEED_DEMO: "false",
      SGP_AUTO_SYNC_ENABLED: "false",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "validation-encryption-key-32-chars-min",
      JWT_ACCESS_SECRET:
        process.env.JWT_ACCESS_SECRET ?? "validation-access-secret-change-me",
      JWT_REFRESH_SECRET:
        process.env.JWT_REFRESH_SECRET ?? "validation-refresh-secret-change-me",
    },
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

async function waitForApi() {
  await waitFor(`${API_URL}/health`, 60_000);

  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@ispcrm.local", password: "admin123" }),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // retry until API/database are ready
    }
    await wait(1000);
  }

  throw new Error("API não ficou pronta para autenticação após reset do banco.");
}

async function main() {
  try {
    execSync("fuser -k 4000/tcp 9090/tcp 2>/dev/null || true", { stdio: "ignore" });
  } catch {
    // ignore
  }
  await wait(500);

  const mock = startMock();
  let client = await connectDb();
  const tenantId = await resetAndSeed(client);
  await client.end();
  await restartApi();
  await waitForApi();
  client = await connectDb();

  evidence.db.before = await dbCounts(client, tenantId);
  console.log("DB BEFORE:", evidence.db.before);

  await waitFor(`${MOCK_SGP_URL.replace("http", "http")}`, 10_000).catch(() =>
    waitFor(`http://127.0.0.1:${MOCK_SGP_PORT}`, 10_000),
  );
  await waitForApi();

  const token = await login();
  const credentials = await createCredentials(token);
  const started = await triggerSync(token, credentials.id);
  evidence.sync.start = started;

  const run = await pollSync(token, started.runId);
  evidence.sync.result = {
    status: run.status,
    errorMessage: run.errorMessage,
    customersProcessed: run.customers?.processed ?? run.processed,
    customersCreated: run.customers?.created ?? run.created,
    contractsCreated: run.contracts?.created ?? run.contractsCreated,
    invoicesCreated: run.invoices?.created ?? run.invoicesCreated,
    durationMs: run.durationMs,
  };

  await client.end();
  const afterClient = await connectDb();
  evidence.db.after = await dbCounts(afterClient, await resolveTenantId(afterClient));
  await afterClient.end();
  await wait(1000);
  evidence.api.totals = await fetchTotals(token);

  evidence.verdict = {
    syncCompleted: run.status === "COMPLETED",
    dbCustomers: evidence.db.after.sgpCustomers >= 3,
    dbContracts: evidence.db.after.contracts >= 3,
    dbInvoices: evidence.db.after.invoices >= 3,
    apiMatchesDb:
      evidence.api.totals.customers === evidence.db.after.customers &&
      evidence.api.totals.contracts === evidence.db.after.contracts &&
      evidence.api.totals.invoices === evidence.db.after.invoices,
  };

  console.log("\n=== EVIDENCE ===");
  console.log(JSON.stringify(evidence, null, 2));

  mock.kill("SIGTERM");

  if (
    !evidence.verdict.syncCompleted ||
    !evidence.verdict.dbCustomers ||
    !evidence.verdict.dbContracts ||
    !evidence.verdict.dbInvoices ||
    !evidence.verdict.apiMatchesDb
  ) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
