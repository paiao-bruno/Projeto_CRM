#!/usr/bin/env node
/**
 * Teste de persistência do Funil: logout/login, reinício do web e build não apagam dados.
 * Usa exclusivamente banco descartável isp_crm_web_e2e.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { setTimeout as wait } from "node:timers/promises";
import { Client } from "pg";
import {
  assertDisposableDatabase,
  DEFAULT_E2E_DATABASE_URL,
} from "./lib/disposable-db.mjs";
import { applyDisposableMigrations } from "./lib/apply-disposable-migrations.mjs";
import { resolveJwtSecretForDev } from "./lib/jwt-secret.mjs";

const PORT = Number(process.env.WEB_E2E_PORT ?? 3002);
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;

async function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function countDeals() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  const result = await client.query(`SELECT COUNT(*)::int AS c FROM "Deal"`);
  await client.end();
  return result.rows[0].c;
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return await response.json();
    } catch {
      // booting
    }
    await wait(1000);
  }
  throw new Error("Health timeout");
}

function startWeb(env) {
  return spawn("npm", ["run", "dev", "-w", "apps/web", "--", "-p", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    env,
  });
}

async function main() {
  process.env.ALLOW_DISPOSABLE_DB = "true";
  assertDisposableDatabase(DATABASE_URL, { requireFlag: true });

  const admin = new Client({
    connectionString: `postgresql://crm:crm@localhost:5432/postgres`,
  });
  await admin.connect();
  const target = assertDisposableDatabase(DATABASE_URL, { requireFlag: false });
  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
    target.database,
  ]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${target.database}" OWNER crm`);
  }
  await admin.end();

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.end();

  spawnSync("npm", ["run", "prisma:generate"], { stdio: "inherit" });
  await applyDisposableMigrations(DATABASE_URL);

  const password = `E2e${randomBytes(10).toString("base64url")}A1`;
  spawnSync(
    "node",
    ["scripts/bootstrap-web-only.mjs"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL,
        WEB_BOOTSTRAP_TENANT_NAME: "Persist Tenant",
        WEB_BOOTSTRAP_TENANT_SLUG: "persist-tenant",
        WEB_BOOTSTRAP_ADMIN_NAME: "Persist Admin",
        WEB_BOOTSTRAP_ADMIN_EMAIL: "persist-admin@test.local",
        WEB_BOOTSTRAP_ADMIN_PASSWORD: password,
      },
    },
  );

  const serverEnv = {
    ...process.env,
    DATABASE_URL,
    NEXT_PUBLIC_API_URL: "/api",
    NEXT_PUBLIC_WEB_ONLY_MODE: "true",
    JWT_ACCESS_SECRET: resolveJwtSecretForDev({ env: { NODE_ENV: "development" } }),
    NODE_ENV: "development",
  };

  const server = startWeb(serverEnv);
  try {
    await waitForHealth();

    const login1 = await (
      await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "persist-admin@test.local", password }),
      })
    ).json();

    const board = await (
      await fetch(`${BASE}/api/sales-funnel/board`, {
        headers: { Authorization: `Bearer ${login1.accessToken}` },
      })
    ).json();

    const createRes = await fetch(`${BASE}/api/sales-funnel/deals`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${login1.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Oportunidade Sentinela",
        stageCode: board.stages[0].code,
        priority: "MEDIUM",
      }),
    });
    const created = await createRes.json();
    const afterCreate = await countDeals();
    assertCount(afterCreate, 1, "após criar");

    // simula logout/login — sem endpoint destrutivo
    const login2 = await (
      await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "persist-admin@test.local", password }),
      })
    ).json();

    const boardAfterLogin = await (
      await fetch(`${BASE}/api/sales-funnel/board`, {
        headers: { Authorization: `Bearer ${login2.accessToken}` },
      })
    ).json();
    const found = boardAfterLogin.stages
      .flatMap((s) => s.deals)
      .find((d) => d.id === created.id);
    if (!found) throw new Error("Oportunidade sumiu após relogin");

    server.kill("SIGKILL");
    await wait(2000);

    const server2 = startWeb(serverEnv);
    await waitForHealth();

    const login3 = await (
      await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "persist-admin@test.local", password }),
      })
    ).json();
    const boardAfterRestart = await (
      await fetch(`${BASE}/api/sales-funnel/board`, {
        headers: { Authorization: `Bearer ${login3.accessToken}` },
      })
    ).json();
    const afterRestart = boardAfterRestart.stages
      .flatMap((s) => s.deals)
      .find((d) => d.id === created.id);
    if (!afterRestart) throw new Error("Oportunidade sumiu após reinício do web");

    const afterRestartCount = await countDeals();
    assertCount(afterRestartCount, 1, "após reinício");

    spawnSync("npm", ["run", "build", "-w", "apps/web"], { stdio: "inherit" });
    const afterBuildCount = await countDeals();
    assertCount(afterBuildCount, 1, "após build");

    server2.kill("SIGKILL");

    console.log(
      JSON.stringify(
        {
          ok: true,
          dealId: created.id,
          counts: { afterCreate, afterRestartCount, afterBuildCount },
        },
        null,
        2,
      ),
    );
  } finally {
    if (!server.killed) server.kill("SIGKILL");
  }
}

function assertCount(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Contagem ${label}: esperado ${expected}, obtido ${actual}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
