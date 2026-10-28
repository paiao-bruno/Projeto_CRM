#!/usr/bin/env node
/**
 * E2E HTTP da caixa de entrada: Next.js real (modo web-only) + PostgreSQL descartável.
 * Fluxo: login -> evento simulado -> fila -> assumir -> responder (replay) -> encerrar -> 401/404.
 * Nunca usa o banco de desenvolvimento: exige banco *_e2e/_test e ALLOW_DISPOSABLE_DB=true.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import { Client } from "pg";
import { assertDisposableDatabase } from "./lib/disposable-db.mjs";
import { applyDisposableMigrations } from "./lib/apply-disposable-migrations.mjs";
import { resolveJwtSecretForDev } from "./lib/jwt-secret.mjs";

const PORT = Number(process.env.INBOX_E2E_PORT ?? 3003);
const BASE = `http://127.0.0.1:${PORT}`;
const adminUrl = process.env.INBOX_TEST_ADMIN_URL ?? "postgresql://crm:crm@localhost:5432/postgres";
const targetUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = "/vertice_inbox_e2e";
  u.search = "?schema=public";
  return u.toString();
})();

process.env.ALLOW_DISPOSABLE_DB = "true";
const target = assertDisposableDatabase(targetUrl, { requireFlag: true });

const admin = new Client({ connectionString: adminUrl });
await admin.connect();
if ((await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [target.database])).rowCount === 0) {
  await admin.query(`CREATE DATABASE "${target.database}"`);
}
await admin.end();
const db = new Client({ connectionString: targetUrl });
await db.connect();
await db.query("DROP SCHEMA IF EXISTS public CASCADE");
await db.query("CREATE SCHEMA public");
await db.end();
await applyDisposableMigrations(targetUrl);

const password = `E2e${randomBytes(10).toString("base64url")}A1`;
const boot = spawnSync("node", ["scripts/bootstrap-web-only.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: targetUrl,
    WEB_BOOTSTRAP_TENANT_NAME: "Org E2E Teste",
    WEB_BOOTSTRAP_TENANT_SLUG: "org-e2e-teste",
    WEB_BOOTSTRAP_ADMIN_NAME: "Admin E2E",
    WEB_BOOTSTRAP_ADMIN_EMAIL: "admin-e2e@test.local",
    WEB_BOOTSTRAP_ADMIN_PASSWORD: password,
  },
});
assert.equal(boot.status, 0, "bootstrap web-only falhou");

const server = spawn("npm", ["run", "dev", "-w", "apps/web", "--", "-p", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    DATABASE_URL: targetUrl,
    NEXT_PUBLIC_API_URL: "/api",
    NEXT_PUBLIC_WEB_ONLY_MODE: "true",
    JWT_ACCESS_SECRET: resolveJwtSecretForDev({ env: { NODE_ENV: "development" } }),
    NODE_ENV: "development",
  },
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function http(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await response.json(); } catch { /* sem corpo */ }
  return { status: response.status, json };
}

try {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* iniciando */ }
    await wait(1000);
    if (i === 119) throw new Error("Next nao iniciou a tempo");
  }

  assert.equal((await http("/api/inbox/conversations")).status, 401, "sem token deve ser 401");

  const login = await http("/api/auth/login", { method: "POST", body: { email: "admin-e2e@test.local", password } });
  assert.ok([200, 201].includes(login.status), `login falhou: ${login.status}`);
  const token = login.json.accessToken;

  const caps = await http("/api/inbox/capabilities", { token });
  assert.equal(caps.json.demoInbound, true);

  const event = { providerEventId: `e2e-${Date.now()}`, contactName: "Cliente E2E", contactPhone: "+55 11 97777-0001", text: "Preciso de suporte" };
  const first = await http("/api/inbox/demo-inbound", { token, method: "POST", body: event });
  assert.equal(first.status, 201);
  assert.equal(first.json.duplicate, false);
  const replay = await http("/api/inbox/demo-inbound", { token, method: "POST", body: event });
  assert.equal(replay.json.duplicate, true);

  const queue = await http("/api/inbox/conversations?tab=queue", { token });
  assert.equal(queue.status, 200);
  assert.equal(queue.json.items.length, 1, "replay nao pode duplicar conversa");
  const id = queue.json.items[0].id;

  const claimed = await http(`/api/inbox/conversations/${id}/claim`, { token, method: "POST" });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.json.can.reply, true);
  const again = await http(`/api/inbox/conversations/${id}/claim`, { token, method: "POST" });
  assert.equal(again.status, 409, "assumir duas vezes deve dar 409");

  const reply = { body: "Ola! Ja estou verificando.", clientMessageId: "e2e-client-msg-1" };
  const r1 = await http(`/api/inbox/conversations/${id}/messages`, { token, method: "POST", body: reply });
  const r2 = await http(`/api/inbox/conversations/${id}/messages`, { token, method: "POST", body: reply });
  assert.equal(r1.status, 201);
  assert.equal(r1.json.id, r2.json.id, "reenvio com mesmo clientMessageId nao duplica");

  const detail = await http(`/api/inbox/conversations/${id}`, { token });
  assert.equal(detail.json.messages.filter((m) => m.direction === "OUTBOUND").length, 1);

  const closed = await http(`/api/inbox/conversations/${id}/close`, { token, method: "POST", body: { expectedVersion: detail.json.version } });
  assert.equal(closed.json.status, "SOLVED");
  const stale = await http(`/api/inbox/conversations/${id}/reopen`, { token, method: "POST", body: { expectedVersion: 1 } });
  assert.equal(stale.status, 409);

  const members = await http("/api/inbox/members", { token });
  assert.ok(members.json.length >= 1);
  assert.equal((await http("/api/inbox/presence", { token, method: "POST", body: { status: "ONLINE" } })).status, 200);
  assert.equal((await http("/api/inbox/conversations/nao-uuid", { token })).status, 404);

  console.log(JSON.stringify({ ok: true, conversationId: id }, null, 2));
} catch (error) {
  console.error(serverLog.split("\n").slice(-30).join("\n"));
  throw error;
} finally {
  server.kill("SIGKILL");
  await wait(500);
}
process.exit(0);
