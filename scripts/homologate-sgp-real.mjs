#!/usr/bin/env node
/**
 * Homologação com API SGP REAL.
 *
 * Variáveis obrigatórias:
 *   SGP_API_URL  — ex: https://webmais.sgp.net.br
 *   SGP_APP      — identificador da aplicação SGP
 *   SGP_TOKEN    — token de autenticação SGP
 *
 * Variáveis opcionais:
 *   API_URL, DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as wait } from "node:timers/promises";
import bcrypt from "bcryptjs";
import { Client } from "pg";

const ROOT = process.cwd();
const RAW_API = process.env.API_URL ?? "http://localhost:4000";
const API_URL = RAW_API.endsWith("/api") ? RAW_API : `${RAW_API.replace(/\/$/, "")}/api`;
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:51214/isp_crm?schema=public";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@ispcrm.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";

const SGP = {
  apiUrl: process.env.SGP_API_URL?.trim(),
  app: process.env.SGP_APP?.trim(),
  token: process.env.SGP_TOKEN?.trim(),
};

const report = {
  startedAt: new Date().toISOString(),
  mode: "real-sgp",
  prerequisites: {},
  auth: {},
  sync: {},
  data: {},
  pagination: {},
  errorHandling: {},
  issues: [],
  passed: [],
};

function log(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(data, null, 2));
}

function fail(step, message) {
  report.issues.push({ step, message });
  console.error(`\n[FALHA] ${step}: ${message}`);
}

function pass(step, detail = "") {
  report.passed.push({ step, detail });
}

async function ensureAdminUser(client) {
  const existing = await client.query(`SELECT id FROM "User" WHERE email = $1`, [ADMIN_EMAIL]);
  if (existing.rows.length > 0) return;

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const tenant = await client.query(
    `INSERT INTO "Tenant" (id, name, slug, status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), 'Homologação ISP', 'homolog', 'ACTIVE', NOW(), NOW())
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const tenantId = tenant.rows[0].id;
  const user = await client.query(
    `INSERT INTO "User" (id, email, name, "passwordHash", status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'Admin Homolog', $2, 'ACTIVE', NOW(), NOW())
     RETURNING id`,
    [ADMIN_EMAIL, passwordHash],
  );
  const role = await client.query(
    `INSERT INTO "Role" (id, "tenantId", name, scope, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'Administrador', 'TENANT', NOW(), NOW())
     ON CONFLICT ("tenantId", name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [tenantId],
  );
  await client.query(
    `INSERT INTO "TenantMember" (id, "tenantId", "userId", "roleId", status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE', NOW(), NOW())
     ON CONFLICT ("tenantId", "userId") DO UPDATE SET status = 'ACTIVE'`,
    [tenantId, user.rows[0].id, role.rows[0].id],
  );
}

async function waitForApi() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "invalid", password: "x" }),
      });
      if (res.status < 500) return;
    } catch {
      // retry
    }
    await wait(500);
  }
  throw new Error("API não respondeu a tempo.");
}

function startApi() {
  return spawn("node", ["apps/api/dist/main.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL,
      AUTO_SEED_DEMO: "false",
      SGP_AUTO_SYNC_ENABLED: "false",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "validation-encryption-key-32-chars-min",
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "validation-access-secret-change-me",
    },
    stdio: "ignore",
  });
}

async function login() {
  const started = performance.now();
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const durationMs = Math.round(performance.now() - started);
  const body = await res.json();
  if (!res.ok) throw new Error(`Login falhou: ${res.status} ${JSON.stringify(body)}`);
  return { token: body.accessToken, durationMs };
}

async function apiPost(token, path, payload = {}) {
  const started = performance.now();
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const durationMs = Math.round(performance.now() - started);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body, durationMs };
}

async function apiGet(token, path) {
  const started = performance.now();
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const durationMs = Math.round(performance.now() - started);
  const body = await res.json();
  return { ok: res.ok, status: res.status, body, durationMs };
}

async function waitSync(token, runId) {
  const started = Date.now();
  while (Date.now() - started < 900_000) {
    const { body } = await apiGet(token, `/integrations/sgp/sync-runs/${runId}`);
    if (body.status && body.status !== "RUNNING") {
      return body;
    }
    await wait(1000);
  }
  throw new Error(`Sync ${runId} não finalizou em 15 minutos.`);
}

async function dbCounts(client, tenantId) {
  const q = async (sql) => (await client.query(sql, [tenantId])).rows[0].c;
  return {
    customers: await q(`SELECT COUNT(*)::int c FROM "Customer" WHERE "tenantId"=$1 AND "deletedAt" IS NULL`),
    contracts: await q(`SELECT COUNT(*)::int c FROM "Contract" WHERE "tenantId"=$1 AND "deletedAt" IS NULL`),
    invoices: await q(`SELECT COUNT(*)::int c FROM "Invoice" WHERE "tenantId"=$1 AND "deletedAt" IS NULL`),
  };
}

function printCredentialInstructions() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  INTERVENÇÃO NECESSÁRIA — Credenciais SGP reais ausentes         ║
╠══════════════════════════════════════════════════════════════════╣
║  Execute no terminal (substitua pelos seus valores reais):       ║
║                                                                  ║
║  export SGP_API_URL="https://SUA-INSTANCIA.sgp.net.br"           ║
║  export SGP_APP="seu-app"                                        ║
║  export SGP_TOKEN="seu-token"                                    ║
║  node scripts/homologate-sgp-real.mjs                            ║
║                                                                  ║
║  Opcional: ADMIN_EMAIL, ADMIN_PASSWORD, DATABASE_URL, API_URL      ║
╚══════════════════════════════════════════════════════════════════╝
`);
}

async function main() {
  if (!SGP.apiUrl || !SGP.app || !SGP.token) {
    report.prerequisites.missing = ["SGP_API_URL", "SGP_APP", "SGP_TOKEN"].filter(
      (key) => !process.env[key]?.trim(),
    );
    printCredentialInstructions();
    fs.writeFileSync(
      path.join(ROOT, "homologation-report.json"),
      JSON.stringify(report, null, 2),
    );
    process.exit(2);
  }

  report.prerequisites = {
    sgpApiUrl: SGP.apiUrl.replace(/\/\/[^@]+@/, "//***@"),
    sgpApp: SGP.app,
    tokenConfigured: Boolean(SGP.token),
  };

  spawnSync("npm", ["run", "build", "-w", "apps/api"], { cwd: ROOT, stdio: "inherit" });

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  await ensureAdminUser(db);

  const apiProcess = startApi();
  await waitForApi();

  try {
    const { token, durationMs: loginMs } = await login();
    report.auth.login = { ok: true, durationMs: loginMs };
    pass("login", `${loginMs}ms`);

    const testAuth = await apiPost(token, "/integrations/sgp/credentials/test", {
      apiUrl: SGP.apiUrl,
      app: SGP.app,
      token: SGP.token,
    });
    report.auth.sgpTestAuth = {
      ok: testAuth.ok,
      status: testAuth.status,
      durationMs: testAuth.durationMs,
    };
    if (testAuth.ok) {
      pass("sgp-autenticacao", `${testAuth.durationMs}ms`);
    } else {
      fail("sgp-autenticacao", `HTTP ${testAuth.status}: ${JSON.stringify(testAuth.body).slice(0, 200)}`);
    }

    let credentialId;
    const existing = await apiGet(token, "/integrations/sgp/credentials");
    const match = existing.body?.find?.((item) => item.apiUrl === SGP.apiUrl);
    if (match) {
      credentialId = match.id;
      await apiPost(token, `/integrations/sgp/credentials/${credentialId}/test`, {});
    } else {
      const created = await apiPost(token, "/integrations/sgp/credentials", {
        name: "SGP Homologação",
        apiUrl: SGP.apiUrl,
        app: SGP.app,
        token: SGP.token,
      });
      if (!created.ok) fail("sgp-credentials", JSON.stringify(created.body));
      else {
        credentialId = created.body.id;
        pass("sgp-credentials", credentialId);
      }
    }

    const beforeCounts = await dbCounts(db, (await db.query(`SELECT "tenantId" FROM "TenantMember" LIMIT 1`)).rows[0]?.tenantId);
    report.data.beforeSync = beforeCounts;

    const fullStart = await apiPost(token, "/integrations/sgp/sync-customers", {
      credentialId,
      full: true,
    });
    if (!fullStart.ok || !fullStart.body?.runId) {
      fail("sync-completa", JSON.stringify(fullStart.body));
    } else {
      const fullRun = await waitSync(token, fullStart.body.runId);
      report.sync.full = {
        status: fullRun.status,
        durationMs: fullRun.durationMs,
        processed: fullRun.customers?.processed ?? fullRun.processed,
        created: fullRun.created,
        updated: fullRun.updated,
        ignored: fullRun.ignored,
        customersDeleted: fullRun.customers?.deleted ?? 0,
        contractsDeleted: fullRun.contracts?.deleted ?? 0,
        invoicesDeleted: fullRun.invoices?.deleted ?? 0,
      };
      if (fullRun.status === "COMPLETED" || fullRun.status === "PARTIAL") {
        pass("sync-completa", `${fullRun.durationMs}ms · ${report.sync.full.processed} clientes`);
      } else {
        fail("sync-completa", fullRun.status);
      }
    }

    const afterFull = await dbCounts(db, (await db.query(`SELECT "tenantId" FROM "TenantMember" LIMIT 1`)).rows[0]?.tenantId);
    report.data.afterFullSync = afterFull;

    const incStart = await apiPost(token, "/integrations/sgp/sync-customers", { credentialId });
    if (!incStart.ok || !incStart.body?.runId) {
      fail("sync-incremental", JSON.stringify(incStart.body));
    } else {
      const incRun = await waitSync(token, incStart.body.runId);
      report.sync.incremental = {
        status: incRun.status,
        durationMs: incRun.durationMs,
        processed: incRun.customers?.processed ?? incRun.processed,
        created: incRun.created,
        updated: incRun.updated,
        ignored: incRun.ignored,
        contractsDeleted: incRun.contracts?.deleted ?? 0,
        invoicesDeleted: incRun.invoices?.deleted ?? 0,
      };
      if (incRun.status === "COMPLETED" || incRun.status === "PARTIAL") {
        pass("sync-incremental", `${incRun.durationMs}ms`);
      } else {
        fail("sync-incremental", incRun.status);
      }
    }

    report.data.afterIncrementalSync = await dbCounts(
      db,
      (await db.query(`SELECT "tenantId" FROM "TenantMember" LIMIT 1`)).rows[0]?.tenantId,
    );

    for (const endpoint of ["/customers", "/contracts", "/invoices"]) {
      const pages = [];
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const res = await apiGet(token, `${endpoint}?page=${page}&limit=50`);
        if (!res.ok) fail(`paginacao${endpoint}`, `HTTP ${res.status}`);
        totalPages = res.body.totalPages ?? 1;
        pages.push({
          page,
          durationMs: res.durationMs,
          total: res.body.total,
          dataLength: res.body.data?.length ?? 0,
        });
        page += 1;
      }
      report.pagination[endpoint] = pages;
      pass(`paginacao${endpoint}`, `${pages.length} páginas · total ${pages[0]?.total ?? 0}`);
    }

    const badAuth = await apiPost(token, "/integrations/sgp/credentials/test", {
      apiUrl: SGP.apiUrl,
      app: SGP.app,
      token: "token-invalido-homologacao",
    });
    report.errorHandling.invalidToken = {
      status: badAuth.status,
      ok: badAuth.ok,
      handled: !badAuth.ok,
    };
    if (!badAuth.ok) pass("erro-token-invalido");
    else fail("erro-token-invalido", "API deveria rejeitar token inválido");

    const unavailable = await apiPost(token, "/integrations/sgp/credentials/test", {
      apiUrl: "http://127.0.0.1:1",
      app: "x",
      token: "x",
      timeoutMs: 2000,
    });
    report.errorHandling.unavailable = {
      status: unavailable.status,
      ok: unavailable.ok,
      handled: !unavailable.ok,
      durationMs: unavailable.durationMs,
    };
    if (!unavailable.ok) pass("erro-indisponivel", `${unavailable.durationMs}ms`);
    else fail("erro-indisponivel", "API deveria falhar para host inacessível");

    const badUrl = await apiPost(token, "/integrations/sgp/credentials/test", {
      apiUrl: "https://invalid.example.invalid",
      app: "x",
      token: "x",
      timeoutMs: 5000,
    });
    report.errorHandling.unexpectedResponse = {
      status: badUrl.status,
      ok: badUrl.ok,
      handled: !badUrl.ok,
      durationMs: badUrl.durationMs,
    };
    if (!badUrl.ok) pass("erro-resposta-inesperada");
    else fail("erro-resposta-inesperada", "Esperado erro para host inválido");
  } finally {
    apiProcess.kill("SIGTERM");
    await db.end();
  }

  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.passed.length,
    failed: report.issues.length,
    readyForProduction: report.issues.length === 0,
  };

  fs.writeFileSync(path.join(ROOT, "homologation-report.json"), JSON.stringify(report, null, 2));
  log("RELATÓRIO DE HOMOLOGAÇÃO", report.summary);

  if (report.issues.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
