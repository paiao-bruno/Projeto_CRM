/**
 * Testes de integração da caixa de entrada contra PostgreSQL REAL e DESCARTÁVEL.
 * Executar via `npm run test:inbox-integration` (cria o banco e aplica as migrations).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import type { ServerAuthUser } from "../auth";
import { HttpError } from "../http";
import { InboxService } from "./service";

const url = process.env.DATABASE_URL ?? "";
if (!/_(e2e|test)\b|test/i.test(url.split("/").pop() ?? "") || process.env.ALLOW_DISPOSABLE_DB !== "true") {
  throw new Error("Recusado: DATABASE_URL precisa ser banco descartavel e ALLOW_DISPOSABLE_DB=true.");
}

const pool = new Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const service = new InboxService(prisma);

type Person = { user: ServerAuthUser };
type Org = { tenantId: string; agents: Person[]; supervisor: Person; reader: Person };

async function perm(code: string) {
  return prisma.permission.upsert({
    where: { code },
    update: {},
    create: { code, description: code },
  });
}

async function seedOrg(slug: string, agentCount: number): Promise<Org> {
  const tenant = await prisma.tenant.create({ data: { name: `Org ${slug}`, slug, status: "ACTIVE" } });
  const [read, reply, transfer] = await Promise.all([perm("chat.read"), perm("chat.reply"), perm("chat.transfer")]);

  async function role(name: string, perms: { id: string; code: string }[]) {
    const created = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        name,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    return created;
  }
  const agentRole = await role("Atendente", [read, reply]);
  const supervisorRole = await role("Supervisor", [read, reply, transfer]);
  const readerRole = await role("Leitor", [read]);

  async function person(label: string, roleId: string, codes: string[]): Promise<Person> {
    const user = await prisma.user.create({
      data: {
        name: `${label} ${slug}`,
        email: `${label.toLowerCase().replace(/\s+/g, "-")}@${slug}.test.local`,
        passwordHash: "hash-not-used-in-these-tests",
        status: "ACTIVE",
      },
    });
    const member = await prisma.tenantMember.create({
      data: { tenantId: tenant.id, userId: user.id, roleId, status: "ACTIVE" },
    });
    return {
      user: {
        sub: user.id,
        email: user.email,
        name: user.name,
        tenantId: tenant.id,
        tenantName: tenant.name,
        memberId: member.id,
        role: label,
        permissions: codes,
      },
    };
  }

  const agents: Person[] = [];
  for (let i = 1; i <= agentCount; i += 1) {
    agents.push(await person(`Agente ${i}`, agentRole.id, ["chat.read", "chat.reply"]));
  }
  return {
    tenantId: tenant.id,
    agents,
    supervisor: await person("Supervisor", supervisorRole.id, ["chat.read", "chat.reply", "chat.transfer"]),
    reader: await person("Leitor", readerRole.id, ["chat.read"]),
  };
}

async function expectHttp(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => error instanceof HttpError && error.status === status);
}

let orgA: Org;
let orgB: Org;
let seq = 0;

function inbound(overrides: Partial<Parameters<InboxService["ingestInbound"]>[1]> = {}) {
  seq += 1;
  return {
    provider: "demo",
    providerEventId: `evt-${seq}`,
    contactName: "Cliente Sintetico",
    contactPhone: `+55 11 90000-${String(1000 + seq)}`,
    text: `mensagem ${seq}`,
    ...overrides,
  };
}

before(async () => {
  orgA = await seedOrg("alfa-test", 8);
  orgB = await seedOrg("beta-test", 1);
});

after(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe("ingestao idempotente", () => {
  it("replay do mesmo evento nao duplica contato, conversa, mensagem nem contador", async () => {
    const event = inbound();
    const first = await service.ingestInbound(orgA.tenantId, event);
    const replay = await service.ingestInbound(orgA.tenantId, event);
    assert.equal(first.duplicate, false);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.conversationId, first.conversationId);

    const messages = await prisma.message.count({ where: { conversationId: first.conversationId! } });
    assert.equal(messages, 1);
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: first.conversationId! } });
    assert.equal(conversation.unreadCount, 1);
  });

  it("entregas simultaneas do mesmo evento resultam em uma unica mensagem", async () => {
    const event = inbound();
    const results = await Promise.all(Array.from({ length: 10 }, () => service.ingestInbound(orgA.tenantId, event)));
    assert.equal(results.filter((r) => !r.duplicate).length, 1);
    const ids = new Set(results.map((r) => r.conversationId));
    assert.equal(ids.size, 1);
    assert.equal(await prisma.message.count({ where: { conversationId: [...ids][0]! } }), 1);
  });

  it("detecta mesmo id de evento com conteudo diferente", async () => {
    const event = inbound();
    await service.ingestInbound(orgA.tenantId, event);
    const tampered = await service.ingestInbound(orgA.tenantId, { ...event, text: "outro texto" });
    assert.equal(tampered.duplicate, true);
    assert.equal(tampered.payloadMismatch, true);
  });

  it("eventos distintos do mesmo contato, em paralelo, usam um contato e uma conversa abertos", async () => {
    const phone = "+55 11 98888-7777";
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => service.ingestInbound(orgA.tenantId, inbound({ contactPhone: phone, text: `p${i}` }))),
    );
    const conversationIds = new Set(results.map((r) => r.conversationId));
    assert.equal(conversationIds.size, 1);
    const customers = await prisma.customer.count({ where: { tenantId: orgA.tenantId, phone: "5511988887777" } });
    assert.equal(customers, 1);
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: [...conversationIds][0]! } });
    assert.equal(conversation.unreadCount, 6);
  });

  it("protocolos concorrentes sao unicos e sequenciais por organizacao", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => service.ingestInbound(orgB.tenantId, inbound())));
    const protocols = results.map((r) => (r as { protocol: string | null }).protocol);
    assert.equal(new Set(protocols).size, 12);
    const seqs = protocols.map((p) => Number(p!.split("-")[1])).sort((a, b) => a - b);
    assert.deepEqual(seqs, Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("rejeita entrada invalida", async () => {
    await expectHttp(service.ingestInbound(orgA.tenantId, inbound({ contactPhone: "12" })), 422);
    await expectHttp(service.ingestInbound(orgA.tenantId, inbound({ text: "   " })), 422);
    await expectHttp(service.ingestInbound(orgA.tenantId, inbound({ provider: "Bad Provider!" })), 422);
  });

  it("mensagem nova em conversa encerrada abre novo protocolo", async () => {
    const event = inbound();
    const first = await service.ingestInbound(orgA.tenantId, event);
    await service.claim(orgA.agents[0].user, first.conversationId!);
    await service.close(orgA.agents[0].user, first.conversationId!, {});
    const second = await service.ingestInbound(orgA.tenantId, inbound({ contactPhone: event.contactPhone }));
    assert.notEqual(second.conversationId, first.conversationId);
  });
});

describe("assumir atendimento (concorrencia)", () => {
  it("8 atendentes assumindo a mesma conversa: exatamente um vence, os demais recebem 409", async () => {
    const ingested = await service.ingestInbound(orgA.tenantId, inbound());
    const outcomes = await Promise.allSettled(orgA.agents.map((a) => service.claim(a.user, ingested.conversationId!)));
    const won = outcomes.filter((o) => o.status === "fulfilled");
    const lost = outcomes.filter((o) => o.status === "rejected") as PromiseRejectedResult[];
    assert.equal(won.length, 1);
    assert.equal(lost.length, 7);
    for (const l of lost) assert.ok(l.reason instanceof HttpError && l.reason.status === 409);

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: ingested.conversationId! } });
    assert.ok(orgA.agents.some((a) => a.user.memberId === conversation.assignedMemberId));
    const claimedEvents = await prisma.conversationEvent.count({
      where: { conversationId: conversation.id, type: "CLAIMED" },
    });
    assert.equal(claimedEvents, 1);
  });

  it("leitor sem chat.reply nao assume", async () => {
    const ingested = await service.ingestInbound(orgA.tenantId, inbound());
    await expectHttp(service.claim(orgA.reader.user, ingested.conversationId!), 403);
  });
});

describe("isolamento entre organizacoes e visibilidade", () => {
  it("usuario de outra organizacao nao le, assume, responde nem lista", async () => {
    const ingested = await service.ingestInbound(orgA.tenantId, inbound());
    const intruder = orgB.agents[0].user;
    await expectHttp(service.get(intruder, ingested.conversationId!), 404);
    await expectHttp(service.claim(intruder, ingested.conversationId!), 404);
    await expectHttp(
      service.reply(intruder, ingested.conversationId!, { body: "oi", clientMessageId: "intruso-0001" }),
      404,
    );
    const list = await service.list(intruder, { tab: "queue", limit: 100 });
    assert.ok(list.items.every((item) => item.id !== ingested.conversationId));
    const search = await service.list(intruder, { tab: "queue", search: "Cliente Sintetico" });
    assert.ok(search.items.every((item) => item.id !== ingested.conversationId));
  });

  it("atendente nao ve conversa assumida por colega; supervisor ve e aba 'all' exige supervisao", async () => {
    const ingested = await service.ingestInbound(orgA.tenantId, inbound());
    const [a, b] = orgA.agents;
    await service.claim(a.user, ingested.conversationId!);
    await expectHttp(service.get(b.user, ingested.conversationId!), 404);
    assert.ok((await service.get(orgA.supervisor.user, ingested.conversationId!)).id);
    await expectHttp(service.list(b.user, { tab: "all" }), 403);
    assert.ok((await service.list(orgA.supervisor.user, { tab: "all", limit: 100 })).total > 0);
    const mineB = await service.list(b.user, { tab: "mine", limit: 100 });
    assert.ok(mineB.items.every((item) => item.id !== ingested.conversationId));
  });

  it("recusa identificadores malformados", async () => {
    await expectHttp(service.get(orgA.agents[0].user, "nao-e-uuid"), 404);
  });
});

describe("transferencia, encerramento e fencing por versao", () => {
  it("transfere, registra handoff e historico, e nega destino invalido", async () => {
    const ingested = await service.ingestInbound(orgA.tenantId, inbound());
    const id = ingested.conversationId!;
    const [a, b] = orgA.agents;
    await service.claim(a.user, id);

    await expectHttp(service.transfer(b.user, id, { toMemberId: a.user.memberId }), 404);
    await expectHttp(service.transfer(a.user, id, { toMemberId: orgA.reader.user.memberId }), 422);
    await expectHttp(service.transfer(a.user, id, { toMemberId: orgB.agents[0].user.memberId }), 422);

    const moved = await service.transfer(a.user, id, { toMemberId: b.user.memberId, reason: "especialista" });
    assert.equal(moved.assigneeId, b.user.memberId);
    assert.equal(moved.stillVisible, false);
    assert.equal(await prisma.conversationHandoff.count({ where: { conversationId: id, status: "COMPLETED" } }), 1);
    assert.equal(await prisma.conversationEvent.count({ where: { conversationId: id, type: "TRANSFERRED" } }), 1);
    await expectHttp(service.reply(a.user, id, { body: "ainda aqui?", clientMessageId: "a-after-0001" }), 404);
  });

  it("expectedVersion desatualizada falha com 409 e nao altera a conversa", async () => {
    const ingested = await service.ingestInbound(orgA.tenantId, inbound());
    const id = ingested.conversationId!;
    const a = orgA.agents[0];
    const claimed = await service.claim(a.user, id);
    await expectHttp(service.close(a.user, id, { expectedVersion: claimed.version - 1 }), 409);
    assert.equal((await service.get(a.user, id)).status, "OPEN");
    const closed = await service.close(a.user, id, { expectedVersion: claimed.version, reason: "resolvido" });
    assert.equal(closed.status, "SOLVED");
    assert.equal(closed.can.reply, false);
    const reopened = await service.reopen(a.user, id, {});
    assert.equal(reopened.status, "OPEN");
  });

  it("transferencias concorrentes: apenas uma aplica", async () => {
    const ingested = await service.ingestInbound(orgA.tenantId, inbound());
    const id = ingested.conversationId!;
    const [a, b, c] = orgA.agents;
    const v = (await service.claim(a.user, id)).version;
    const results = await Promise.allSettled([
      service.transfer(orgA.supervisor.user, id, { toMemberId: b.user.memberId, expectedVersion: v }),
      service.transfer(orgA.supervisor.user, id, { toMemberId: c.user.memberId, expectedVersion: v }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(await prisma.conversationHandoff.count({ where: { conversationId: id } }), 1);
  });
});

describe("respostas", () => {
  it("resposta e idempotente por clientMessageId e fica marcada como nao enviada", async () => {
    const ingested = await service.ingestInbound(orgA.tenantId, inbound());
    const id = ingested.conversationId!;
    const a = orgA.agents[0];
    await service.claim(a.user, id);
    const payload = { body: "Ola, ja estou verificando.", clientMessageId: "client-msg-0001" };
    const results = await Promise.all([service.reply(a.user, id, payload), service.reply(a.user, id, payload), service.reply(a.user, id, payload)]);
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    const detail = await service.get(a.user, id);
    const outbound = detail.messages.filter((m) => m.direction === "OUTBOUND");
    assert.equal(outbound.length, 1);
    assert.deepEqual(outbound[0].metadata, { delivery: "RECORDED_ONLY" });
  });

  it("nota interna nao e marcada como entrega e nao-atendente nao responde", async () => {
    const ingested = await service.ingestInbound(orgA.tenantId, inbound());
    const id = ingested.conversationId!;
    const [a, b] = orgA.agents;
    await service.claim(a.user, id);
    await service.reply(a.user, id, { body: "nota", internal: true, clientMessageId: "client-note-0001" });
    const detail = await service.get(a.user, id);
    assert.equal(detail.messages.at(-1)!.direction, "INTERNAL");
    await expectHttp(service.reply(b.user, id, { body: "x", clientMessageId: "client-b-0001" }), 404);
    await expectHttp(service.reply(a.user, id, { body: "", clientMessageId: "client-a-0002" }), 422);
  });

  it("marcar como lida zera contador somente para quem atende", async () => {
    const ingested = await service.ingestInbound(orgA.tenantId, inbound());
    const id = ingested.conversationId!;
    const [a] = orgA.agents;
    await service.claim(a.user, id);
    await expectHttp(service.markRead(orgA.supervisor.user, id), 403);
    await service.markRead(a.user, id);
    assert.equal((await service.get(a.user, id)).unreadCount, 0);
  });
});

describe("presenca e equipe", () => {
  it("heartbeat atualiza presenca; membros listados somente da propria organizacao", async () => {
    const a = orgA.agents[0];
    await service.heartbeat(a.user, "ONLINE");
    await service.heartbeat(orgA.agents[1].user, "AWAY");
    const members = await service.listMembers(a.user);
    const byId = new Map(members.map((m) => [m.id, m]));
    assert.equal(byId.get(a.user.memberId)?.presence, "ONLINE");
    assert.equal(byId.get(orgA.agents[1].user.memberId)?.presence, "AWAY");
    assert.equal(byId.get(orgA.agents[2].user.memberId)?.presence, "OFFLINE");
    assert.ok(!byId.has(orgB.agents[0].user.memberId));
    assert.ok(!byId.has(orgA.reader.user.memberId));
    await expectHttp(service.heartbeat(a.user, "INVALID"), 422);
  });
});
