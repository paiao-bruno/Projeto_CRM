#!/usr/bin/env node
/**
 * E2E do modo web-only em banco descartável (isp_crm_web_e2e).
 * Não inicia apps/api, NestJS nem SGP.
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

const PORT = Number(process.env.WEB_E2E_PORT ?? 3001);
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;

const requestsLog = [];

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

function runSync(label, command, args, env = process.env) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} falhou com código ${result.status}`);
  }
}

async function ensureE2eDatabase() {
  const target = assertDisposableDatabase(DATABASE_URL, { requireFlag: false });
  const admin = new Client({
    connectionString: `postgresql://crm:crm@${target.host}:${target.port}/postgres`,
  });
  await admin.connect();
  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
    target.database,
  ]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${target.database}" OWNER crm`);
  }
  await admin.end();
}

async function resetSchema() {
  process.env.ALLOW_DISPOSABLE_DB = "true";
  assertDisposableDatabase(DATABASE_URL, { requireFlag: true });
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.end();
}

async function apiFetch(path, options = {}) {
  const url = `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
  requestsLog.push(url);
  if (url.includes(":4000")) {
    throw new Error(`Requisição indevida para porta 4000: ${url}`);
  }
  const response = await fetch(url, options);
  return response;
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await apiFetch("/api/health");
      if (response.ok) {
        const body = await response.json();
        if (body.mode === "web-only" && body.apiBaseUrl === "/api") {
          return body;
        }
      }
    } catch {
      // server still booting
    }
    await wait(1000);
  }
  throw new Error("Servidor web-only não ficou pronto a tempo.");
}

function findNestProcesses() {
  const result = spawnSync("pgrep", ["-af", "dist/main.js|nest start|apps/api/dist"], {
    encoding: "utf8",
  });
  return result.stdout.trim();
}

function startWebServer(env) {
  const args = ["run", "dev", "-w", "apps/web", "--", "-p", String(PORT)];
  if (args.includes("apps/api")) {
    throw new Error("Tentativa de iniciar apps/api detectada no spawn.");
  }

  return spawn("npm", args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    env,
  });
}

async function bootstrapAdmin(password) {
  runSync(
    "bootstrap web-only",
    "node",
    ["scripts/bootstrap-web-only.mjs"],
    {
      ...process.env,
      DATABASE_URL,
      WEB_BOOTSTRAP_TENANT_NAME: "E2E Web Tenant",
      WEB_BOOTSTRAP_TENANT_SLUG: "e2e-web-tenant",
      WEB_BOOTSTRAP_ADMIN_NAME: "E2E Admin",
      WEB_BOOTSTRAP_ADMIN_EMAIL: "e2e-admin@test.local",
      WEB_BOOTSTRAP_ADMIN_PASSWORD: password,
    },
  );
}

async function main() {
  console.log("[e2e:web-only] Preparando banco descartável...");
  await ensureE2eDatabase();
  await resetSchema();

  runSync("prisma generate", "npm", ["run", "prisma:generate"]);
  await applyDisposableMigrations(DATABASE_URL);

  const password = `E2e${randomBytes(10).toString("base64url")}A1`;
  await bootstrapAdmin(password);

  const jwtSecret = resolveJwtSecretForDev({ env: { NODE_ENV: "development" } });
  const serverEnv = {
    ...process.env,
    DATABASE_URL,
    NEXT_PUBLIC_API_URL: "/api",
    NEXT_PUBLIC_WEB_ONLY_MODE: "true",
    SGP_AUTO_SYNC_ENABLED: "false",
    JWT_ACCESS_SECRET: jwtSecret,
    NODE_ENV: "development",
  };

  if (await isPortListening(PORT)) {
    throw new Error(`Porta ${PORT} já está em uso.`);
  }
  if (await isPortListening(4000)) {
    throw new Error("Porta 4000 está em escuta — abortando para evitar API legada.");
  }

  const nestBefore = findNestProcesses();
  const server = startWebServer(serverEnv);
  let server2 = null;
  let serverOutput = "";

  server.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    serverOutput += text;
    if (text.includes("[api]") || text.includes("dist/main.js")) {
      throw new Error("Saída indica inicialização indevida da API NestJS.");
    }
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  try {
    const health = await waitForHealth();
    console.log("[e2e:web-only] Health OK:", JSON.stringify(health));

    const loginRes = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "e2e-admin@test.local", password }),
    });
    if (!loginRes.ok) {
      throw new Error(`Login falhou: ${loginRes.status}`);
    }
    const login = await loginRes.json();
    const token = login.accessToken;

    const meRes = await apiFetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) throw new Error("/auth/me falhou");

    const boardRes = await apiFetch("/api/sales-funnel/board", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const board = await boardRes.json();
    const stage1 = board.stages[0];
    const stage2 = board.stages[1];

    const createRes = await apiFetch("/api/sales-funnel/deals", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Oportunidade E2E",
        stageCode: stage1.code,
        priority: "HIGH",
      }),
    });
    const created = await createRes.json();

    await apiFetch(`/api/sales-funnel/deals/${created.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Oportunidade E2E Editada" }),
    });

    const detailRes = await apiFetch(`/api/sales-funnel/deals/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const detail = await detailRes.json();

    const moveRes = await apiFetch(`/api/sales-funnel/deals/${created.id}/move`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stageId: stage2.id,
        position: 0,
        version: detail.version,
      }),
    });
    if (!moveRes.ok) throw new Error(`Move falhou: ${moveRes.status}`);

    const metricsRes = await apiFetch("/api/sales-funnel/metrics", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metricsRes.ok) throw new Error("Metrics falhou");

    const boardAfter = await (
      await apiFetch("/api/sales-funnel/board", {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    const persisted = boardAfter.stages
      .flatMap((stage) => stage.deals)
      .find((deal) => deal.id === created.id);
    if (!persisted || persisted.title !== "Oportunidade E2E Editada") {
      throw new Error("Persistência imediata falhou");
    }

    server.kill("SIGTERM");
    await wait(2000);

    server2 = startWebServer(serverEnv);
    try {
      await waitForHealth();
      const boardRestart = await (
        await apiFetch("/api/sales-funnel/board", {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json();
      const afterRestart = boardRestart.stages
        .flatMap((stage) => stage.deals)
        .find((deal) => deal.id === created.id);
      if (!afterRestart) {
        throw new Error("Persistência após reinício falhou");
      }
    } finally {
      if (server2 && !server2.killed) {
        server2.kill("SIGKILL");
      }
      await wait(1000);
    }

    const legacyPaths = ["/customers", "/contracts", "/invoices"];
    for (const path of legacyPaths) {
      const pageRes = await fetch(`${BASE}${path}`);
      if (!pageRes.ok) throw new Error(`Página ${path} indisponível`);
    }

    if (requestsLog.some((url) => url.includes("4000"))) {
      throw new Error("Detectada requisição para porta 4000");
    }

    const nestAfter = findNestProcesses();
    if (nestAfter && nestAfter !== nestBefore) {
      throw new Error("Processo NestJS detectado após E2E.");
    }

    if (await isPortListening(4000)) {
      throw new Error("Porta 4000 entrou em escuta durante E2E.");
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          health,
          dealId: created.id,
          persistedTitle: persisted.title,
          requests: requestsLog.length,
          port: PORT,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("[e2e:web-only] FALHA:", error.message);
    console.error(serverOutput.slice(-2000));
    process.exitCode = 1;
  } finally {
    if (server2 && !server2.killed) server2.kill("SIGKILL");
    if (!server.killed) server.kill("SIGKILL");
  }
}

main()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
