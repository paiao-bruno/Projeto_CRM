#!/usr/bin/env node
/**
 * E2E HTTP do site único: Next.js real + worker + PostgreSQL descartável, SEM NestJS e SEM SGP.
 * Prova de independência: variáveis SGP ausentes, porta 4000 nunca aberta, guard de rede server-side
 * (conexões fora do loopback e para a porta 4000 são bloqueadas e registradas).
 * Pré-requisito: TEST_DATABASE_ADMIN_URL (ver scripts/lib/test-db-harness.mjs).
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import bcrypt from "bcryptjs";
import pg from "pg";
import { HarnessError, repoRoot, runCli, migrateDeploy, generatePrismaClient, withDisposableDatabases } from "./lib/test-db-harness.mjs";
import { killTree, spawnManaged } from "./lib/proc.mjs";

const guardPath = join(repoRoot, "scripts/lib/network-guard.cjs");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(800);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.on("error", () => resolve(false));
  });
}

function sign(secret, body, timestamp = String(Math.floor(Date.now() / 1000))) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
  return { "x-vertice-timestamp": timestamp, "x-vertice-signature": `v1=${digest}` };
}

await runCli(async () => {
  const work = mkdtempSync(join(tmpdir(), "vertice-e2e-"));
  const guardLog = join(work, "network-guard.log");
  writeFileSync(guardLog, "");
  const steps = [];
  const step = (name) => { steps.push(name); console.log(`[e2e] ${name}`); };

  // Autoteste do guard: precisa bloquear host externo e a porta 4000.
  const probe = spawnSync(process.execPath, ["-r", guardPath, "-e",
    "const net=require('net');const s=net.connect(80,'192.0.2.1');s.on('error',e=>{console.log(e.code);process.exit(0)})"], {
    env: { ...process.env, NETWORK_GUARD_LOG: guardLog }, encoding: "utf8" });
  assert.equal(probe.stdout.trim(), "ENETGUARD", "guard de rede deve bloquear host externo");
  assert.match(readFileSync(guardLog, "utf8"), /BLOQUEADO 192\.0\.2\.1:80/);
  writeFileSync(guardLog, "");
  step("guard de rede validado (bloqueia host externo)");

  await withDisposableDatabases({}, async (ctx) => {
    migrateDeploy(ctx);
    generatePrismaClient();

    const adminA = { email: "admin-a@e2e.test.local", password: `E2e${randomBytes(9).toString("base64url")}A1` };
    const adminB = { email: "admin-b@e2e.test.local", password: `E2e${randomBytes(9).toString("base64url")}A1` };
    for (const [slug, admin] of [["org-a", adminA], ["org-b", adminB]]) {
      const boot = spawnSync(process.execPath, ["scripts/bootstrap-web-only.mjs"], {
        cwd: repoRoot, stdio: "inherit",
        env: {
          ...process.env, DATABASE_URL: ctx.databaseUrl,
          WEB_BOOTSTRAP_TENANT_NAME: `Org ${slug}`, WEB_BOOTSTRAP_TENANT_SLUG: slug,
          WEB_BOOTSTRAP_ADMIN_NAME: `Admin ${slug}`, WEB_BOOTSTRAP_ADMIN_EMAIL: admin.email,
          WEB_BOOTSTRAP_ADMIN_PASSWORD: admin.password,
        },
      });
      assert.equal(boot.status, 0, `bootstrap ${slug} falhou`);
    }

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SGP_|NEXT_PUBLIC_API_URL|NEXT_PUBLIC_WEB_ONLY_MODE|LEGACY_API_ENABLED)/.test(k)));
    const env = {
      ...baseEnv,
      DATABASE_URL: ctx.databaseUrl,
      JWT_ACCESS_SECRET: randomBytes(32).toString("base64url"),
      APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      NETWORK_GUARD_LOG: guardLog,
      NODE_OPTIONS: `--require ${guardPath}`,
    };
    for (const key of Object.keys(env)) assert.ok(!/^SGP_/.test(key), "variáveis SGP devem estar ausentes");

    assert.equal(await isListening(4000), false, "porta 4000 não pode estar em uso");

    let serverLog = "";
    let web = null;
    let worker = null;
    const nextBin = join(repoRoot, "node_modules/next/dist/bin/next");
    // Modo produção: o "next dev" consulta o registro npm (verificação de versão do próprio
    // tooling), o que não é tráfego da aplicação e poluiria a prova de independência.
    const build = spawnSync(process.execPath, [nextBin, "build"], { cwd: join(repoRoot, "apps/web"), env, encoding: "utf8" });
    assert.equal(build.status, 0, `next build falhou: ${(build.stdout + build.stderr).slice(-1500)}`);

    const startWeb = async () => {
      web = spawnManaged(process.execPath, [nextBin, "start", "-p", String(port)], { stdio: ["ignore", "pipe", "pipe"], env, cwd: join(repoRoot, "apps/web") });
      web.child.stdout.on("data", (d) => (serverLog += d));
      web.child.stderr.on("data", (d) => (serverLog += d));
      for (let i = 0; i < 150; i += 1) {
        try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* iniciando */ }
        await wait(1000);
      }
      throw new HarnessError("Next não iniciou a tempo", "SERVER_TIMEOUT");
    };

    const http = async (path, { token, method = "GET", body, headers = {}, raw } = {}) => {
      const response = await fetch(`${base}${path}`, {
        method, redirect: "manual",
        headers: { ...(raw === undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        body: raw ?? (body ? JSON.stringify(body) : undefined),
      });
      let json = null;
      try { json = await response.clone().json(); } catch { /* sem corpo JSON */ }
      return { status: response.status, json, response };
    };
    const login = async ({ email, password }) => {
      const result = await http("/api/auth/login", { method: "POST", body: { email, password } });
      assert.equal(result.status === 200 || result.status === 201, true, `login falhou (${result.status})`);
      return result.json.accessToken;
    };

    try {
      await startWeb();
      worker = spawnManaged(process.execPath, ["scripts/outbox-worker.mjs"], { stdio: ["ignore", "pipe", "pipe"], env, cwd: repoRoot });
      let workerLog = "";
      worker.child.stdout.on("data", (d) => (workerLog += d));
      worker.child.stderr.on("data", (d) => (workerLog += d));

      const health = await http("/api/health");
      assert.equal(health.json.mode, "single-site");
      assert.equal(health.json.database, "ok");
      step("servidor único no ar sem NestJS/SGP (health single-site, banco ok)");

      assert.equal((await http("/api/customers")).status, 401);
      const tokenA = await login(adminA);
      const tokenB = await login(adminB);

      for (const route of ["/login", "/dashboard", "/inbox", "/sales-funnel", "/customers", "/contracts", "/invoices", "/ai-agents", "/integrations"]) {
        const page = await http(route, { headers: { Accept: "text/html" } });
        assert.equal(page.status, 200, `rota ${route} deve responder 200`);
      }
      const chat = await http("/chat", { headers: { Accept: "text/html" } });
      assert.ok([307, 308].includes(chat.status) && chat.response.headers.get("location")?.endsWith("/inbox"), "/chat deve redirecionar para /inbox");
      step("todas as rotas do menu respondem; /chat redireciona para /inbox");

      // Dashboard vazio: "sem dados", não falha.
      const emptyDash = await http("/api/dashboard", { token: tokenA });
      assert.equal(emptyDash.status, 200);
      assert.equal(emptyDash.json.customers.hasData, false);
      assert.equal(emptyDash.json.source, "local");

      // CRUD local.
      const customer = await http("/api/customers", { token: tokenA, method: "POST", body: { name: "Cliente Local E2E", document: "111.222.333-44", email: "cliente@e2e.test", status: "ACTIVE" } });
      assert.equal(customer.status, 201);
      const dup = await http("/api/customers", { token: tokenA, method: "POST", body: { name: "Duplicado", document: "111.222.333-44" } });
      assert.equal(dup.status, 409);
      const contract = await http("/api/contracts", { token: tokenA, method: "POST", body: { customerId: customer.json.id, planName: "Fibra 300", serviceLogin: "cliente.e2e" } });
      assert.equal(contract.status, 201);
      assert.equal(contract.json.origin, "LOCAL");
      const invoice = await http("/api/invoices", { token: tokenA, method: "POST", body: { customerId: customer.json.id, contractId: contract.json.id, amount: "99,90", dueDate: "2020-01-10" } });
      assert.equal(invoice.status, 201);
      assert.equal(invoice.json.amountCents, 9990);
      const agent = await http("/api/ai-agents", { token: tokenA, method: "POST", body: { name: "Agente E2E", provider: "OPENAI", model: "modelo-x", systemPrompt: "Seja objetivo." } });
      assert.equal(agent.status, 201);
      assert.equal((await http(`/api/ai-agents/${agent.json.id}/toggle`, { token: tokenA, method: "POST" })).json.status, "INACTIVE");
      assert.equal((await http(`/api/customers/${customer.json.id}`, { token: tokenA, method: "PATCH", body: { name: "Cliente Local Editado" } })).json.name, "Cliente Local Editado");
      step("CRUD local de clientes, contratos, faturas e agentes");

      const dash = await http("/api/dashboard", { token: tokenA });
      assert.equal(dash.json.customers.total, 1);
      assert.equal(dash.json.invoices.overdueOpen.count, 1);
      assert.equal(dash.json.invoices.overdueOpen.amountCents, 9990);

      // Isolamento entre organizações.
      assert.equal((await http(`/api/customers/${customer.json.id}`, { token: tokenB })).status, 404);
      assert.equal((await http("/api/customers", { token: tokenB })).json.total, 0);
      assert.equal((await http("/api/dashboard", { token: tokenB })).json.customers.hasData, false);
      assert.equal((await http(`/api/invoices/${invoice.json.id}`, { token: tokenB, method: "DELETE" })).status, 404);
      step("isolamento entre organizações (leitura, escrita, dashboard)");

      // Permissões: usuário apenas com chat.read.
      const db = new pg.Client({ connectionString: ctx.databaseUrl });
      await db.connect();
      const tenant = (await db.query(`SELECT id FROM "Tenant" WHERE slug='org-a'`)).rows[0];
      const perm = (await db.query(`SELECT id FROM "Permission" WHERE code='chat.read'`)).rows[0];
      const role = (await db.query(`INSERT INTO "Role" (id,"tenantId",name,"updatedAt") VALUES (gen_random_uuid(),$1,'Leitor E2E',now()) RETURNING id`, [tenant.id])).rows[0];
      await db.query(`INSERT INTO "RolePermission" (id,"roleId","permissionId") VALUES (gen_random_uuid(),$1,$2)`, [role.id, perm.id]).catch(async () => {
        await db.query(`INSERT INTO "RolePermission" ("roleId","permissionId") VALUES ($1,$2)`, [role.id, perm.id]);
      });
      const hash = await bcrypt.hash("Leitor-e2e-123", 8);
      const reader = (await db.query(`INSERT INTO "User" (id,name,email,"passwordHash",status,"updatedAt") VALUES (gen_random_uuid(),'Leitor','leitor@e2e.test.local',$1,'ACTIVE',now()) RETURNING id`, [hash])).rows[0];
      await db.query(`INSERT INTO "TenantMember" (id,"tenantId","userId","roleId",status,"updatedAt") VALUES (gen_random_uuid(),$1,$2,$3,'ACTIVE',now())`, [tenant.id, reader.id, role.id]);
      await db.end();
      const tokenReader = await login({ email: "leitor@e2e.test.local", password: "Leitor-e2e-123" });
      assert.equal((await http("/api/customers", { token: tokenReader })).status, 403);
      assert.equal((await http("/api/dashboard", { token: tokenReader })).status, 403);
      assert.equal((await http("/api/channels", { token: tokenReader })).status, 403);
      assert.equal((await http("/api/inbox/conversations", { token: tokenReader })).status, 200);
      step("permissões respeitadas (403 sem permissão, 200 com chat.read)");

      // Canal de teste + webhook assinado + SSE + worker.
      const channel = await http("/api/channels", { token: tokenA, method: "POST", body: { name: "Canal E2E", adapter: "test" } });
      assert.equal(channel.status, 201);
      const secret = channel.json.secret;
      assert.match(secret, /^whsec_/);
      assert.ok(!JSON.stringify((await http("/api/channels", { token: tokenA })).json).includes(secret), "lista não expõe o segredo");

      const sse = await fetch(`${base}/api/realtime/stream`, { headers: { Authorization: `Bearer ${tokenA}` } });
      assert.equal(sse.status, 200);
      assert.match(sse.headers.get("content-type") ?? "", /text\/event-stream/);
      const reader2 = sse.body.getReader();
      const decoder = new TextDecoder();
      let sseText = "";
      const pump = (async () => { for (;;) { const { done, value } = await reader2.read(); if (done) break; sseText += decoder.decode(value); } })().catch(() => undefined);
      for (let i = 0; i < 50 && !sseText.includes("event: ready"); i += 1) await wait(100);
      assert.ok(sseText.includes("event: ready"), "SSE deve anunciar ready");
      assert.equal((await fetch(`${base}/api/realtime/stream`)).status, 401, "SSE exige autenticação");

      const payload = JSON.stringify({ type: "message.received", eventId: "e2e-evt-1", contact: { phone: "+55 11 94444-0001", name: "Contato Webhook" }, message: { text: "Olá via webhook" } });
      assert.equal((await http(`/api/webhooks/inbound/${channel.json.id}`, { method: "POST", raw: payload })).status, 401, "sem assinatura");
      assert.equal((await http(`/api/webhooks/inbound/${channel.json.id}`, { method: "POST", raw: payload, headers: sign("segredo-errado", payload) })).status, 401);
      const accepted = await http(`/api/webhooks/inbound/${channel.json.id}`, { method: "POST", raw: payload, headers: sign(secret, payload) });
      assert.deepEqual(accepted.json, { status: "accepted" });
      assert.deepEqual((await http(`/api/webhooks/inbound/${channel.json.id}`, { method: "POST", raw: payload, headers: sign(secret, payload) })).json, { status: "duplicate" });
      const big = "x".repeat(300 * 1024);
      assert.equal((await http(`/api/webhooks/inbound/${channel.json.id}`, { method: "POST", raw: big, headers: sign(secret, big) })).status, 413);
      for (let i = 0; i < 50 && !sseText.includes("message.received"); i += 1) await wait(100);
      assert.ok(sseText.includes("message.received"), "SSE deve emitir o evento após o commit");
      assert.ok(!sseText.includes(tokenA), "token nunca aparece no fluxo");
      step("webhook assinado (401/401/200/duplicate/413) e evento SSE entregue");

      const queue = await http("/api/inbox/conversations?tab=queue", { token: tokenA });
      assert.equal(queue.json.items.length, 1);
      const conversationId = queue.json.items[0].id;
      assert.equal((await http(`/api/inbox/conversations?tab=queue`, { token: tokenB })).json.items.length, 0);
      assert.equal((await http(`/api/inbox/conversations/${conversationId}/claim`, { token: tokenA, method: "POST" })).status, 200);

      const reply = await http(`/api/inbox/conversations/${conversationId}/messages`, { token: tokenA, method: "POST", body: { body: "Resposta pelo canal de teste", clientMessageId: "e2e-client-0001" } });
      assert.equal(reply.status, 201);
      let delivery = null;
      for (let i = 0; i < 80; i += 1) {
        const detail = await http(`/api/inbox/conversations/${conversationId}`, { token: tokenA });
        delivery = detail.json.messages.find((m) => m.id === reply.json.id)?.delivery;
        if (delivery?.status === "ACCEPTED") break;
        await wait(250);
      }
      assert.equal(delivery?.status, "ACCEPTED", `worker deve aceitar a entrega (estado: ${delivery?.status}) ${workerLog.slice(-300)}`);
      const deliveries = await http("/api/channels/deliveries", { token: tokenA });
      assert.equal(deliveries.json.worker.alive, true);

      const providerId = `test-${reply.json.id}`;
      const receipt = JSON.stringify({ type: "message.status", eventId: "e2e-rcpt-1", providerMessageId: providerId, status: "DELIVERED" });
      assert.deepEqual((await http(`/api/webhooks/inbound/${channel.json.id}`, { method: "POST", raw: receipt, headers: sign(secret, receipt) })).json, { status: "accepted" });

      await http(`/api/channels/${channel.json.id}`, { token: tokenA, method: "PATCH", body: { behavior: "timeout" } });
      const second = await http(`/api/inbox/conversations/${conversationId}/messages`, { token: tokenA, method: "POST", body: { body: "Esta terá resultado desconhecido", clientMessageId: "e2e-client-0002" } });
      let unknown = null;
      for (let i = 0; i < 80; i += 1) {
        const detail = await http(`/api/inbox/conversations/${conversationId}`, { token: tokenA });
        unknown = detail.json.messages.find((m) => m.id === second.json.id)?.delivery;
        if (unknown?.status === "UNKNOWN") break;
        await wait(250);
      }
      assert.equal(unknown?.status, "UNKNOWN");
      assert.equal(unknown.attempts, 1, "sem retry cego");
      assert.equal((await http(`/api/inbox/conversations/${conversationId}/messages/${second.json.id}/delivery`, { token: tokenA, method: "POST", body: { action: "mark_failed" } })).status, 200);
      step("resposta -> outbox -> worker -> ACCEPTED/DELIVERED; timeout -> UNKNOWN sem retry cego");

      // Funil continua operacional.
      const board = await http("/api/sales-funnel/board", { token: tokenA });
      assert.equal(board.status, 200);
      const deal = await http("/api/sales-funnel/deals", { token: tokenA, method: "POST", body: { title: "Negócio E2E", stageCode: board.json.stages[0].code, priority: "HIGH" } });
      assert.ok([200, 201].includes(deal.status), `deal: ${deal.status}`);
      step("funil de vendas operacional no mesmo site");

      // Persistência após reinício do servidor.
      await reader2.cancel().catch(() => undefined);
      await pump;
      killTree(web.child);
      await web.exited;
      assert.equal(await isListening(port), false);
      await startWeb();
      const tokenA2 = await login(adminA);
      const after = await http("/api/customers", { token: tokenA2 });
      assert.equal(after.json.total, 2, "cliente local + contato criado pelo webhook");
      assert.ok(after.json.data.some((c) => c.name === "Cliente Local Editado"));
      assert.equal((await http("/api/invoices", { token: tokenA2 })).json.data[0].amountCents, 9990);
      assert.equal((await http("/api/sales-funnel/board", { token: tokenA2 })).status, 200);
      step("dados persistem após reiniciar o servidor");

      assert.equal(await isListening(4000), false, "porta 4000 continua fechada");
      const guard = readFileSync(guardLog, "utf8").trim();
      assert.equal(guard, "", `conexões bloqueadas/registradas pelo guard:\n${guard}`);
      assert.ok(!/nest|dist\/main\.js/i.test(serverLog), "log do servidor não pode citar NestJS");
      step("independência provada: nenhuma conexão externa nem à porta 4000");
    } catch (error) {
      console.error("--- log do servidor (últimas linhas) ---\n" + serverLog.split("\n").slice(-40).join("\n"));
      throw error;
    } finally {
      if (worker) killTree(worker.child);
      if (web) killTree(web.child);
      await wait(500);
      rmSync(work, { recursive: true, force: true });
    }
  });
  console.log(JSON.stringify({ ok: true, steps }, null, 2));
});
