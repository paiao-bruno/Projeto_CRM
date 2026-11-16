/**
 * Integração de webhook, caixa de saída, worker e tempo real contra PostgreSQL descartável.
 * Executar via `npm run test:outbox-integration`. Nenhum envio real: só o adaptador de teste.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Client, Pool } from "pg";
import type { ServerAuthUser } from "../auth";
import { ChannelsService } from "../channels";
import { HttpError } from "../http";
import { InboxService } from "../inbox/service";
import { REALTIME_CHANNEL, getRealtimeHub, publishEvent, type RealtimeEvent } from "../realtime";
import { decryptSecret, encryptSecret } from "../secret-box";
import { MAX_BODY_BYTES, WebhookService, parseWebhookPayload, signPayload, verifySignature } from "../webhook";
import { registerAdapter, type ChannelAdapter } from "./adapter";
import { OutboxService } from "./service";
import { startOutboxWorker } from "./worker";

const url = process.env.DATABASE_URL ?? "";
const runId = process.env.TEST_DATABASE_RUN_ID ?? "";
if (!runId || !new URL(url).pathname.startsWith(`/vtest_${runId}`)) {
  throw new Error("Recusado: execute via `npm run test:outbox-integration` (banco exclusivo criado pelo harness).");
}

const blockedRequests: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  blockedRequests.push(String(input));
  throw new Error("Rede externa bloqueada nos testes.");
}) as typeof fetch;

const pool = new Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const inbox = new InboxService(prisma);
const channels = new ChannelsService(prisma);
const quick = { leaseMs: 60_000, sendTimeoutMs: 200, baseBackoffMs: 1000, maxBackoffMs: 10_000 };
const outbox = new OutboxService(prisma, quick);

const logged: string[] = [];
const webhook = new WebhookService(channels, prisma, inbox, outbox, (event, fields) => logged.push(`${event} ${JSON.stringify(fields)}`));

const idempotentAdapter: ChannelAdapter = {
  kind: "idem-test",
  idempotentByKey: true,
  async send(request) {
    return { kind: "accepted", providerMessageId: `idem-${request.idempotencyKey}` };
  },
};
registerAdapter(idempotentAdapter);

type Org = { tenantId: string; agent: ServerAuthUser; admin: ServerAuthUser };

async function seedOrg(slug: string): Promise<Org> {
  const tenant = await prisma.tenant.create({ data: { name: `Org ${slug}`, slug, status: "ACTIVE" } });
  const codes = ["chat.read", "chat.reply", "chat.transfer", "crm.manage"];
  const perms = await Promise.all(codes.map((code) => prisma.permission.upsert({ where: { code }, update: {}, create: { code, description: code } })));
  const role = await prisma.role.create({
    data: { tenantId: tenant.id, name: "Admin", permissions: { create: perms.map((p) => ({ permissionId: p.id })) } },
  });
  const user = await prisma.user.create({ data: { name: `U ${slug}`, email: `u@${slug}.test.local`, passwordHash: "x", status: "ACTIVE" } });
  const member = await prisma.tenantMember.create({ data: { tenantId: tenant.id, userId: user.id, roleId: role.id, status: "ACTIVE" } });
  const person: ServerAuthUser = {
    sub: user.id, email: user.email, name: user.name, tenantId: tenant.id, tenantName: tenant.name,
    memberId: member.id, role: "Admin", permissions: codes,
  };
  return { tenantId: tenant.id, agent: person, admin: person };
}

function signedHeaders(secret: string, body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const headers = new Headers({ "x-vertice-timestamp": timestamp, "x-vertice-signature": signPayload(secret, timestamp, Buffer.from(body)) });
  return headers;
}

async function send(connection: { id: string; secret: string }, payload: unknown) {
  const body = JSON.stringify(payload);
  return webhook.handle({ integrationId: connection.id, headers: signedHeaders(connection.secret, body), rawBody: Buffer.from(body) });
}

async function expectStatus(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (e: unknown) => e instanceof HttpError && e.status === status);
}

let seq = 0;
const received = (phone: string, text = "Olá", eventId = `evt-${++seq}-${Math.random().toString(36).slice(2, 8)}`) => ({
  type: "message.received", eventId, contact: { phone, name: "Contato" }, message: { text },
});

describe("webhook, outbox, worker e tempo real", () => {
  let a: Org;
  let b: Org;
  let connA: { id: string; secret: string };
  let connB: { id: string; secret: string };

  before(async () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    a = await seedOrg("ob-a");
    b = await seedOrg("ob-b");
    connA = await channels.create(a.admin, { name: "Canal A", adapter: "test" });
    connB = await channels.create(b.admin, { name: "Canal B", adapter: "test" });
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await pool.end();
  });

  describe("assinatura HMAC", () => {
    const secret = "segredo-de-teste";
    const raw = Buffer.from('{"a": 1}');
    const ts = "1700000000";
    const now = 1_700_000_100_000;

    it("aceita assinatura correta sobre os bytes brutos", () => {
      const signature = signPayload(secret, ts, raw);
      assert.deepEqual(verifySignature({ secret, timestamp: ts, signature, rawBody: raw, nowMs: now }), { ok: true });
    });
    it("rejeita corpo alterado (mesmo JSON equivalente), segredo errado e cabeçalhos ausentes", () => {
      const signature = signPayload(secret, ts, raw);
      const reformatted = Buffer.from('{"a":1}');
      assert.equal(verifySignature({ secret, timestamp: ts, signature, rawBody: reformatted, nowMs: now }).ok, false);
      assert.equal(verifySignature({ secret: "outro", timestamp: ts, signature, rawBody: raw, nowMs: now }).ok, false);
      assert.equal(verifySignature({ secret, timestamp: null, signature, rawBody: raw, nowMs: now }).ok, false);
      assert.equal(verifySignature({ secret, timestamp: ts, signature: "v1=abc", rawBody: raw, nowMs: now }).ok, false);
    });
    it("rejeita timestamp fora da janela (anti-replay)", () => {
      const signature = signPayload(secret, ts, raw);
      const result = verifySignature({ secret, timestamp: ts, signature, rawBody: raw, nowMs: now + 10 * 60_000 });
      assert.deepEqual(result, { ok: false, reason: "stale_timestamp" });
    });
    it("limite de tamanho é 256 KiB", () => assert.equal(MAX_BODY_BYTES, 262_144));
    it("valida o esquema do payload", () => {
      assert.throws(() => parseWebhookPayload({ type: "x", eventId: "1" }), HttpError);
      assert.throws(() => parseWebhookPayload({ type: "message.received", eventId: "", contact: {}, message: {} }), HttpError);
      assert.throws(() => parseWebhookPayload({ type: "message.status", eventId: "1", providerMessageId: "p", status: "WAT" }), HttpError);
    });
  });

  describe("webhook de entrada", () => {
    it("autentica, cria conversa na organização da conexão e ignora tenantId do corpo", async () => {
      const payload = { ...received("+55 11 98888-0001"), tenantId: b.tenantId };
      assert.deepEqual(await send(connA, payload), { status: "accepted" });
      const conversation = await prisma.conversation.findFirst({ where: { channelIntegrationId: connA.id } });
      assert.equal(conversation?.tenantId, a.tenantId);
      assert.equal(await prisma.conversation.count({ where: { tenantId: b.tenantId } }), 0);
    });

    it("rejeita assinatura inválida, conexão desconhecida e conexão desativada com a mesma resposta", async () => {
      const body = JSON.stringify(received("+55 11 98888-0002"));
      await expectStatus(webhook.handle({ integrationId: connA.id, headers: signedHeaders("errado", body), rawBody: Buffer.from(body) }), 401);
      await expectStatus(webhook.handle({ integrationId: "00000000-0000-4000-8000-000000000000", headers: signedHeaders(connA.secret, body), rawBody: Buffer.from(body) }), 401);
      await expectStatus(webhook.handle({ integrationId: "nao-uuid", headers: signedHeaders(connA.secret, body), rawBody: Buffer.from(body) }), 401);
      await channels.update(a.admin, connA.id, { status: "DISABLED" });
      await expectStatus(send(connA, received("+55 11 98888-0002")), 401);
      await channels.update(a.admin, connA.id, { status: "ACTIVE" });
      assert.equal(await prisma.conversation.count({ where: { tenantId: a.tenantId, customer: { phone: { contains: "988880002" } } } }), 0);
    });

    it("segredo da conexão B não autentica na conexão A", async () => {
      const payload = received("+55 11 98888-0003");
      const body = JSON.stringify(payload);
      await expectStatus(webhook.handle({ integrationId: connA.id, headers: signedHeaders(connB.secret, body), rawBody: Buffer.from(body) }), 401);
    });

    it("deduplica por eventId, inclusive em envios concorrentes", async () => {
      const payload = received("+55 11 98888-0004", "concorrente", "evt-dup-concurrent");
      const results = await Promise.all(Array.from({ length: 12 }, () => send(connA, payload)));
      assert.equal(results.filter((r) => r.status === "accepted").length, 1);
      assert.equal(results.filter((r) => r.status === "duplicate").length, 11);
      const count = await prisma.message.count({ where: { tenantId: a.tenantId, externalId: `wh-${connA.id}:evt-dup-concurrent` } });
      assert.equal(count, 1);
    });

    it("mesmo eventId com conteúdo diferente retorna 409", async () => {
      await send(connA, received("+55 11 98888-0005", "original", "evt-mismatch"));
      await expectStatus(send(connA, received("+55 11 98888-0005", "adulterado", "evt-mismatch")), 409);
    });

    it("rejeita JSON inválido e esquema inválido sem criar dados", async () => {
      const body = "{não é json";
      await expectStatus(webhook.handle({ integrationId: connA.id, headers: signedHeaders(connA.secret, body), rawBody: Buffer.from(body) }), 400);
      await expectStatus(send(connA, { type: "message.received", eventId: "e", contact: { phone: "1" }, message: { text: "x" } }), 422);
    });

    it("logs não contêm segredo, assinatura nem corpo", () => {
      const joined = logged.join("\n");
      assert.ok(logged.length > 0);
      for (const forbidden of [connA.secret, connB.secret, "v1=", "Olá"]) assert.ok(!joined.includes(forbidden), `vazou: ${forbidden}`);
    });
  });

  describe("segredos", () => {
    it("cifra e decifra; adulteração é detectada; lista nunca expõe o segredo", async () => {
      const key = Buffer.alloc(32, 9);
      const boxed = encryptSecret("conteudo", key);
      assert.equal(decryptSecret(boxed, key), "conteudo");
      const tampered = boxed.slice(0, -2) + (boxed.endsWith("AA") ? "BB" : "AA");
      assert.throws(() => decryptSecret(tampered, key));
      const list = await channels.list(a.admin);
      assert.ok(!JSON.stringify(list).includes(connA.secret));
      const row = await prisma.integration.findUnique({ where: { id: connA.id } });
      assert.ok(!row?.encryptedSecrets?.includes(connA.secret));
    });

    it("rotação invalida o segredo anterior", async () => {
      const created = await channels.create(a.admin, { name: "Rotativo" });
      const rotated = await channels.rotateSecret(a.admin, created.id);
      await expectStatus(send({ id: created.id, secret: created.secret }, received("+55 11 98888-0006")), 401);
      assert.deepEqual(await send({ id: created.id, secret: rotated.secret }, received("+55 11 98888-0006")), { status: "accepted" });
    });

    it("conexões são isoladas por organização", async () => {
      await expectStatus(channels.update(b.admin, connA.id, { status: "DISABLED" }), 404);
      await expectStatus(channels.rotateSecret(b.admin, connA.id), 404);
      assert.equal((await channels.list(b.admin)).some((c) => c.id === connA.id), false);
    });
  });

  async function openConversation(org: Org, conn: { id: string; secret: string }, phone: string) {
    await send(conn, received(phone));
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: org.tenantId, channelIntegrationId: conn.id, customer: { phone: { contains: phone.replace(/\D/g, "").slice(-8) } } },
    });
    await inbox.claim(org.agent, conversation.id);
    return conversation.id;
  }

  async function reply(org: Org, conversationId: string, clientMessageId = `cid-${Math.random().toString(36).slice(2, 12)}`) {
    return inbox.reply(org.agent, conversationId, { body: "Resposta", clientMessageId });
  }

  async function drain() {
    for (let i = 0; i < 5; i += 1) {
      const { claimed } = await outbox.runOnce(20);
      if (claimed === 0) break;
    }
  }

  describe("caixa de saída", () => {
    it("responder enfileira na mesma transação e o worker entrega via adaptador de teste", async () => {
      const conversationId = await openConversation(a, connA, "+55 11 97777-0001");
      const { id } = await reply(a, conversationId);
      const pending = await prisma.outboundDelivery.findUniqueOrThrow({ where: { messageId: id } });
      assert.equal(pending.status, "PENDING");
      await drain();
      const done = await prisma.outboundDelivery.findUniqueOrThrow({ where: { messageId: id } });
      assert.equal(done.status, "ACCEPTED");
      assert.equal(done.providerMessageId, `test-${id}`);
      const message = await prisma.message.findUniqueOrThrow({ where: { id } });
      assert.equal((message.metadata as Record<string, unknown>).delivery, "ACCEPTED");
    });

    it("resposta repetida (mesmo clientMessageId) gera uma única entrega", async () => {
      const conversationId = await openConversation(a, connA, "+55 11 97777-0002");
      const first = await reply(a, conversationId, "cid-fixo-0001");
      const second = await reply(a, conversationId, "cid-fixo-0001");
      assert.equal(second.duplicate, true);
      assert.equal(second.id, first.id);
      assert.equal(await prisma.outboundDelivery.count({ where: { conversationId } }), 1);
    });

    it("nota interna e conversa sem canal não geram entrega", async () => {
      const conversationId = await openConversation(a, connA, "+55 11 97777-0003");
      await inbox.reply(a.agent, conversationId, { body: "nota", internal: true, clientMessageId: "cid-nota-001" });
      assert.equal(await prisma.outboundDelivery.count({ where: { conversationId } }), 0);
      const demo = await inbox.ingestInbound(a.tenantId, { provider: "demo", providerEventId: "demo-1", contactName: "Demo", contactPhone: "+55 11 96666-0001", text: "oi" });
      await inbox.claim(a.agent, demo.conversationId!);
      const recorded = await inbox.reply(a.agent, demo.conversationId!, { body: "r", clientMessageId: "cid-demo-001" });
      assert.equal(await prisma.outboundDelivery.count({ where: { messageId: recorded.id } }), 0);
      const message = await prisma.message.findUniqueOrThrow({ where: { id: recorded.id } });
      assert.equal((message.metadata as Record<string, unknown>).delivery, "RECORDED_ONLY");
    });

    it("transação revertida não deixa mensagem nem entrega órfãs (atomicidade do enfileiramento)", async () => {
      const conversationId = await openConversation(a, connA, "+55 11 97777-0004");
      const before = await prisma.outboundDelivery.count();
      await assert.rejects(
        prisma.$transaction(async (tx) => {
          const message = await tx.message.create({ data: { tenantId: a.tenantId, conversationId, senderType: "USER", direction: "OUTBOUND", body: "x", externalId: "rollback-1" } });
          await OutboxService.enqueue(tx, { tenantId: a.tenantId, messageId: message.id, conversationId, integrationId: connA.id });
          throw new Error("falha simulada antes do commit");
        }),
      );
      assert.equal(await prisma.outboundDelivery.count(), before);
      assert.equal(await prisma.message.count({ where: { externalId: "rollback-1" } }), 0);
    });

    it("dois workers concorrentes nunca reivindicam a mesma entrega", async () => {
      const conversationId = await openConversation(a, connA, "+55 11 97777-0005");
      for (let i = 0; i < 12; i += 1) await reply(a, conversationId);
      const w1 = new OutboxService(prisma, quick);
      const w2 = new OutboxService(prisma, quick);
      await prisma.outboundDelivery.updateMany({ where: { status: "PENDING", conversationId: { not: conversationId } }, data: { status: "ACCEPTED" } });
      const [x, y] = await Promise.all([w1.claim(8), w2.claim(8), w1.claim(8)]).then(([p, q, r]) => [p, [...q, ...r]] as const);
      const ids = [...x, ...y].map((d) => d.id);
      assert.equal(new Set(ids).size, ids.length, "reivindicação duplicada");
      assert.equal(ids.length, 12);
      for (const claimed of [...x, ...y]) assert.ok(claimed.leaseToken);
      await prisma.outboundDelivery.updateMany({ where: { conversationId }, data: { status: "ACCEPTED", leaseToken: null, leaseExpiresAt: null } });
    });

    it("lease expirado em adaptador sem idempotência vira UNKNOWN (sem reenvio cego)", async () => {
      const conversationId = await openConversation(a, connA, "+55 11 97777-0006");
      const { id } = await reply(a, conversationId);
      const [claimed] = await outbox.claim(1);
      assert.equal(claimed.messageId, id);
      await prisma.outboundDelivery.update({ where: { id: claimed.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
      const reaped = await outbox.reapExpired();
      assert.equal(reaped.unknown >= 1, true);
      const row = await prisma.outboundDelivery.findUniqueOrThrow({ where: { id: claimed.id } });
      assert.equal(row.status, "UNKNOWN");
      assert.equal((await outbox.claim(10)).some((d) => d.id === claimed.id), false);
      assert.equal(await outbox.process(claimed), "stale", "worker antigo não pode concluir (fencing)");
    });

    it("lease expirado com adaptador idempotente volta a PENDING e o worker antigo é barrado por fencing", async () => {
      const idem = await prisma.integration.create({
        data: { tenantId: a.tenantId, provider: "WEBHOOK", name: "Idem", status: "ACTIVE", config: { adapter: "idem-test" } },
      });
      const customer = await prisma.customer.create({ data: { tenantId: a.tenantId, name: "Idem", phone: "5511955550001", status: "ACTIVE" } });
      const conversation = await prisma.conversation.create({ data: { tenantId: a.tenantId, customerId: customer.id, channelIntegrationId: idem.id, status: "OPEN" } });
      const message = await prisma.message.create({ data: { tenantId: a.tenantId, conversationId: conversation.id, senderType: "USER", direction: "OUTBOUND", body: "oi", externalId: "idem-msg-1" } });
      await prisma.outboundDelivery.create({ data: { tenantId: a.tenantId, messageId: message.id, conversationId: conversation.id, integrationId: idem.id } });

      const [first] = await outbox.claim(5).then((c) => c.filter((d) => d.messageId === message.id));
      await prisma.outboundDelivery.update({ where: { id: first.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await outbox.reapExpired()).requeued >= 1, true);
      await prisma.outboundDelivery.update({ where: { id: first.id }, data: { nextAttemptAt: new Date(Date.now() - 1) } });
      const [second] = await outbox.claim(5).then((c) => c.filter((d) => d.messageId === message.id));
      assert.notEqual(second.leaseToken, first.leaseToken);
      assert.equal(await outbox.process(first), "stale");
      assert.equal(await outbox.process(second), "ACCEPTED");
    });

    it("recusa temporária: backoff e esgotamento; recusa definitiva: FAILED", async () => {
      await channels.update(a.admin, connA.id, { behavior: "reject_retryable" });
      const conversationId = await openConversation(a, connA, "+55 11 97777-0007");
      const { id } = await reply(a, conversationId);
      await prisma.outboundDelivery.update({ where: { messageId: id }, data: { maxAttempts: 2 } });
      await drain();
      let row = await prisma.outboundDelivery.findUniqueOrThrow({ where: { messageId: id } });
      assert.equal(row.status, "PENDING");
      assert.equal(row.attempts, 1);
      assert.ok(row.nextAttemptAt.getTime() > Date.now(), "backoff aplicado");
      assert.equal((await outbox.claim(10)).some((d) => d.id === row.id), false, "não reivindica antes do backoff");
      await prisma.outboundDelivery.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1) } });
      await drain();
      row = await prisma.outboundDelivery.findUniqueOrThrow({ where: { messageId: id } });
      assert.equal(row.status, "FAILED");
      assert.equal(row.attempts, 2);

      await channels.update(a.admin, connA.id, { behavior: "reject_permanent" });
      const perm = await reply(a, conversationId);
      await drain();
      assert.equal((await prisma.outboundDelivery.findUniqueOrThrow({ where: { messageId: perm.id } })).status, "FAILED");
    });

    it("timeout ou exceção após iniciar o envio = UNKNOWN, sem retry automático; reconciliação manual", async () => {
      await channels.update(a.admin, connA.id, { behavior: "timeout" });
      const conversationId = await openConversation(a, connA, "+55 11 97777-0008");
      const { id } = await reply(a, conversationId);
      await drain();
      let row = await prisma.outboundDelivery.findUniqueOrThrow({ where: { messageId: id } });
      assert.equal(row.status, "UNKNOWN");
      assert.equal(row.attempts, 1);
      await drain();
      assert.equal((await prisma.outboundDelivery.findUniqueOrThrow({ where: { messageId: id } })).attempts, 1, "sem reenvio cego");

      await expectStatus(inbox.resolveDelivery(b.agent, conversationId, id, "retry"), 404);
      await channels.update(a.admin, connA.id, { behavior: "accept" });
      await inbox.resolveDelivery(a.agent, conversationId, id, "retry");
      await drain();
      row = await prisma.outboundDelivery.findUniqueOrThrow({ where: { messageId: id } });
      assert.equal(row.status, "ACCEPTED");
      await expectStatus(inbox.resolveDelivery(a.agent, conversationId, id, "retry"), 409);

      await channels.update(a.admin, connA.id, { behavior: "throw" });
      const second = await reply(a, conversationId);
      await drain();
      assert.equal((await prisma.outboundDelivery.findUniqueOrThrow({ where: { messageId: second.id } })).status, "UNKNOWN");
      await inbox.resolveDelivery(a.agent, conversationId, second.id, "mark_failed");
      assert.equal((await prisma.outboundDelivery.findUniqueOrThrow({ where: { messageId: second.id } })).status, "FAILED");
      await channels.update(a.admin, connA.id, { behavior: "accept" });
    });

    it("recibos via webhook são monotônicos, idempotentes e restritos à conexão", async () => {
      const conversationId = await openConversation(a, connA, "+55 11 97777-0009");
      const { id } = await reply(a, conversationId);
      await drain();
      const providerMessageId = `test-${id}`;
      const status = (value: string, eventId: string) => ({ type: "message.status", eventId, providerMessageId, status: value });

      assert.deepEqual(await send(connA, status("DELIVERED", "rcpt-1")), { status: "accepted" });
      assert.deepEqual(await send(connA, status("DELIVERED", "rcpt-1")), { status: "duplicate" });
      assert.deepEqual(await send(connA, status("READ", "rcpt-2")), { status: "accepted" });
      assert.deepEqual(await send(connA, status("DELIVERED", "rcpt-3")), { status: "ignored" }, "não regride");
      assert.deepEqual(await send(connB, status("FAILED", "rcpt-x")), { status: "ignored" }, "outra organização não altera");
      const row = await prisma.outboundDelivery.findUniqueOrThrow({ where: { messageId: id } });
      assert.equal(row.status, "READ");
      const message = await prisma.message.findUniqueOrThrow({ where: { id } });
      assert.ok(message.deliveredAt && message.readAt);
    });

    it("detalhe da conversa expõe o estado de entrega de cada mensagem", async () => {
      const conversationId = await openConversation(a, connA, "+55 11 97777-0010");
      const { id } = await reply(a, conversationId);
      let detail = await inbox.get(a.agent, conversationId);
      assert.equal(detail.messages.find((m) => m.id === id)?.delivery?.status, "PENDING");
      await drain();
      detail = await inbox.get(a.agent, conversationId);
      assert.equal(detail.messages.find((m) => m.id === id)?.delivery?.status, "ACCEPTED");
    });

    it("worker dedicado processa em segundo plano, registra heartbeat e encerra de forma limpa", async () => {
      const conversationId = await openConversation(a, connA, "+55 11 97777-0011");
      const { id } = await reply(a, conversationId);
      const handle = startOutboxWorker(new OutboxService(prisma, quick), { intervalMs: 50, log: () => undefined });
      for (let i = 0; i < 100; i += 1) {
        const row = await prisma.outboundDelivery.findUniqueOrThrow({ where: { messageId: id } });
        if (row.status === "ACCEPTED") break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await handle.stop();
      assert.equal((await prisma.outboundDelivery.findUniqueOrThrow({ where: { messageId: id } })).status, "ACCEPTED");
      assert.ok(await prisma.workerHeartbeat.findUnique({ where: { name: "outbox" } }));
      assert.equal((await channels.deliveries(a.admin, new URLSearchParams())).worker.alive, true);
    });
  });

  describe("tempo real (PostgreSQL LISTEN/NOTIFY)", () => {
    it("NOTIFY só é entregue após o commit e nunca após rollback", async () => {
      const listener = new Client({ connectionString: url });
      await listener.connect();
      await listener.query(`LISTEN ${REALTIME_CHANNEL}`);
      const seen: RealtimeEvent[] = [];
      listener.on("notification", (m) => m.payload && seen.push(JSON.parse(m.payload)));

      await assert.rejects(
        prisma.$transaction(async (tx) => {
          await publishEvent(tx, { type: "rolled.back", tenantId: a.tenantId });
          throw new Error("rollback");
        }),
      );
      await prisma.$transaction(async (tx) => publishEvent(tx, { type: "committed", tenantId: a.tenantId }));
      await new Promise((r) => setTimeout(r, 300));
      await listener.end();
      assert.deepEqual(seen.map((e) => e.type), ["committed"]);
    });

    it("hub entrega eventos apenas à organização assinante e eventos de mutação chegam", async () => {
      const eventsA: RealtimeEvent[] = [];
      const eventsB: RealtimeEvent[] = [];
      const hub = getRealtimeHub();
      const offA = hub.subscribe(a.tenantId, (e) => eventsA.push(e));
      const offB = hub.subscribe(b.tenantId, (e) => eventsB.push(e));
      await new Promise((r) => setTimeout(r, 500));
      await send(connA, received("+55 11 95555-0001", "tempo real"));
      await new Promise((r) => setTimeout(r, 500));
      offA();
      offB();
      assert.ok(eventsA.some((e) => e.type === "message.received"));
      assert.equal(eventsB.length, 0);
    });
  });

  it("nenhum acesso de rede externa ocorreu", () => assert.deepEqual(blockedRequests, []));
});
