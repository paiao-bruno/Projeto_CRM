#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import bcrypt from "bcryptjs";
import { Client } from "pg";

const ROOT = process.cwd();
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:51214/isp_crm?schema=public";
const RAW_API = process.env.API_URL ?? "http://localhost:4000";
const API_URL = RAW_API.endsWith("/api") ? RAW_API : `${RAW_API.replace(/\/$/, "")}/api`;
const VOLUME = Number(process.env.LOAD_TEST_VOLUME ?? 2000);
const PAGE_SIZE = Number(process.env.LOAD_TEST_PAGE_SIZE ?? 100);

const report = {
  startedAt: new Date().toISOString(),
  volume: VOLUME,
  seed: {},
  benchmarks: {},
  resources: {},
  optimizations: [],
};

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function seedVolume(client, tenantId, memberId, volume) {
  const started = performance.now();
  await client.query(`DELETE FROM "Invoice" WHERE "tenantId" = $1`, [tenantId]);
  await client.query(`DELETE FROM "Contract" WHERE "tenantId" = $1`, [tenantId]);
  await client.query(`DELETE FROM "Customer" WHERE "tenantId" = $1`, [tenantId]);

  const batchSize = 500;
  for (let offset = 0; offset < volume; offset += batchSize) {
    const count = Math.min(batchSize, volume - offset);
    const values = [];
    const params = [];
    let paramIndex = 1;
    for (let i = 0; i < count; i += 1) {
      const n = offset + i + 1;
      values.push(
        `(gen_random_uuid(), $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, 'ACTIVE', $${paramIndex++}, '{"source":"SGP"}'::jsonb, NOW(), NOW())`,
      );
      params.push(tenantId, memberId, `Cliente Load ${n}`, `${String(n).padStart(11, "0")}`, `${10000 + n}`);
    }
    await client.query(
      `INSERT INTO "Customer" (id, "tenantId", "ownerMemberId", name, document, status, "ispAccountCode", metadata, "createdAt", "updatedAt")
       VALUES ${values.join(",")}`,
      params,
    );
  }

  await client.query(
    `INSERT INTO "Contract" (id, "tenantId", "customerId", "externalId", status, "planName", metadata, "createdAt", "updatedAt")
     SELECT gen_random_uuid(), c."tenantId", c.id, 'contract-' || c."ispAccountCode", 'ACTIVE', 'Plano Load', '{"source":"SGP"}'::jsonb, NOW(), NOW()
     FROM "Customer" c WHERE c."tenantId" = $1`,
    [tenantId],
  );
  await client.query(
    `INSERT INTO "Invoice" (id, "tenantId", "customerId", "externalId", status, "amountCents", metadata, "createdAt", "updatedAt")
     SELECT gen_random_uuid(), c."tenantId", c.id, 'invoice-' || c."ispAccountCode", 'OPEN', 9900, '{"source":"SGP"}'::jsonb, NOW(), NOW()
     FROM "Customer" c WHERE c."tenantId" = $1`,
    [tenantId],
  );

  return { durationMs: Math.round(performance.now() - started), customers: volume };
}

async function benchmarkEndpoint(token, endpoint, pages = 5) {
  const durations = [];
  let total = 0;
  for (let page = 1; page <= pages; page += 1) {
    const started = performance.now();
    const res = await fetch(`${API_URL}${endpoint}?page=${page}&limit=${PAGE_SIZE}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    durations.push(Math.round(performance.now() - started));
    total = body.total ?? total;
    if (!res.ok) throw new Error(`${endpoint} page ${page} failed`);
  }
  return {
    total,
    pages,
    avgMs: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    p95Ms: percentile(durations, 95),
    maxMs: Math.max(...durations),
    samples: durations,
  };
}

async function main() {
  spawnSync("npm", ["run", "build", "-w", "apps/api"], { cwd: ROOT, stdio: "inherit" });

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  const passwordHash = await bcrypt.hash("admin123", 10);
  const tenantRes = await db.query(
    `INSERT INTO "Tenant" (id, name, slug, status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), 'Load Test ISP', 'load-test', 'ACTIVE', NOW(), NOW())
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const tenantId = tenantRes.rows[0].id;
  const userRes = await db.query(
    `INSERT INTO "User" (id, email, name, "passwordHash", status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), 'loadtest@ispcrm.local', 'Load Test', $1, 'ACTIVE', NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash" RETURNING id`,
    [passwordHash],
  );
  const roleRes = await db.query(
    `INSERT INTO "Role" (id, "tenantId", name, scope, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'Administrador', 'TENANT', NOW(), NOW())
     ON CONFLICT ("tenantId", name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [tenantId],
  );
  const memberRes = await db.query(
    `INSERT INTO "TenantMember" (id, "tenantId", "userId", "roleId", status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE', NOW(), NOW())
     ON CONFLICT ("tenantId", "userId") DO UPDATE SET status = 'ACTIVE' RETURNING id`,
    [tenantId, userRes.rows[0].id, roleRes.rows[0].id],
  );

  report.seed = await seedVolume(db, tenantId, memberRes.rows[0].id, VOLUME);

  const apiProcess = spawn("node", ["apps/api/dist/main.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL,
      AUTO_SEED_DEMO: "false",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "validation-encryption-key-32-chars-min",
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "validation-access-secret-change-me",
    },
    stdio: "ignore",
  });

  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "loadtest@ispcrm.local", password: "admin123" }),
      });
      if (res.status < 500) break;
    } catch {
      // retry
    }
    await wait(500);
  }

  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "loadtest@ispcrm.local", password: "admin123" }),
  });
  const { accessToken } = await loginRes.json();

  const memBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();

  report.benchmarks.customers = await benchmarkEndpoint(accessToken, "/customers", 10);
  report.benchmarks.contracts = await benchmarkEndpoint(accessToken, "/contracts", 10);
  report.benchmarks.invoices = await benchmarkEndpoint(accessToken, "/invoices", 10);

  const prismaStarted = performance.now();
  const count = await db.query(
    `SELECT COUNT(*)::int c FROM "Customer" WHERE "tenantId"=$1 AND "deletedAt" IS NULL`,
    [tenantId],
  );
  report.benchmarks.prismaCount = {
    durationMs: Math.round(performance.now() - prismaStarted),
    total: count.rows[0].c,
  };

  const memAfter = process.memoryUsage();
  const cpuAfter = process.cpuUsage(cpuBefore);
  report.resources = {
    heapUsedMb: Math.round(memAfter.heapUsed / 1024 / 1024),
    heapDeltaMb: Math.round((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024),
    cpuUserMs: Math.round(cpuAfter.user / 1000),
    cpuSystemMs: Math.round(cpuAfter.system / 1000),
  };

  apiProcess.kill("SIGTERM");
  await db.end();

  report.finishedAt = new Date().toISOString();
  report.verdict =
    report.benchmarks.contracts.p95Ms <= 500 && report.benchmarks.invoices.p95Ms <= 500
      ? "acceptable"
      : "needs-tuning";

  fs.writeFileSync(path.join(ROOT, "load-test-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
