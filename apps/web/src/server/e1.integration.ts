import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { Pool } from "pg";
import { AccessService } from "./access";
import { login, logout, verifyAccessToken, type ServerAuthUser } from "./auth";
import { BoardsService } from "./boards";
import { DistributionService } from "./distribution";
import { HttpError } from "./http";
import { InboxService } from "./inbox/service";
import { OpsService } from "./ops";
import { SectorsService } from "./sectors";
import { TeamService } from "./team";

const url = process.env.DATABASE_URL ?? "";
const runId = process.env.TEST_DATABASE_RUN_ID ?? "";
if (!runId || !new URL(url).pathname.startsWith(`/vtest_${runId}`)) {
  throw new Error("Recusado: execute via `npm run test:e1-integration`.");
}

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "t".repeat(48);

const pool = new Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const inbox = new InboxService(prisma);
const team = new TeamService(prisma);
const sectors = new SectorsService(prisma);
const dist = new DistributionService(prisma);
const boards = new BoardsService(prisma);
const ops = new OpsService(prisma);
const access = new AccessService(prisma);

async function expectHttp(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => error instanceof HttpError && error.status === status);
}

async function perm(code: string) {
  return prisma.permission.upsert({ where: { code }, update: {}, create: { code, description: code } });
}

async function seed() {
  const tenant = await prisma.tenant.create({ data: { name: "Org E1", slug: `e1-${runId}`, status: "ACTIVE" } });
  const codes = ["chat.read", "chat.reply", "chat.transfer", "team.manage", "audit.read", "dashboard.read"];
  const perms = await Promise.all(codes.map(perm));
  const adminRole = await prisma.role.create({
    data: { tenantId: tenant.id, name: "Administrador", permissions: { create: perms.map((p) => ({ permissionId: p.id })) } },
  });
  const agentRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "Atendente",
      permissions: { create: perms.filter((p) => p.code.startsWith("chat.") && p.code !== "chat.transfer").map((p) => ({ permissionId: p.id })) },
    },
  });
  const passwordHash = await hash("SenhaValida10", 10);
  const user = await prisma.user.create({
    data: { email: `admin-${runId}@e1.test.local`, name: "Admin E1", passwordHash, status: "ACTIVE" },
  });
  const member = await prisma.tenantMember.create({
    data: { tenantId: tenant.id, userId: user.id, roleId: adminRole.id, status: "ACTIVE", displayName: "Admin E1" },
  });
  const actor: ServerAuthUser = {
    sub: user.id,
    email: user.email,
    name: user.name,
    tenantId: tenant.id,
    tenantName: tenant.name,
    memberId: member.id,
    role: "Administrador",
    permissions: codes,
  };
  return { tenant, adminRole, agentRole, actor, email: user.email, password: "SenhaValida10" };
}

let ctx: Awaited<ReturnType<typeof seed>>;

before(async () => {
  ctx = await seed();
});

after(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe("RF01 sessão e recuperação", () => {
  it("login cria sessão; logout a revoga; senha errada e e-mail inexistente falham igual", async () => {
    const ok = await login(ctx.email, ctx.password);
    assert.ok(ok.accessToken);
    assert.ok(ok.user.sid);
    assert.equal(ok.user.tenantId, ctx.actor.tenantId);
    const me = await verifyAccessToken(ok.accessToken);
    assert.equal(me.memberId, ctx.actor.memberId);
    await logout(me);
    await expectHttp(verifyAccessToken(ok.accessToken), 401);
    await expectHttp(login(ctx.email, "erradaaaaa1"), 401);
    await expectHttp(login("naoexiste@e1.test.local", "SenhaValida10"), 401);
  });

  it("reset de senha é de uso único e encerra sessões", async () => {
    const issued = await access.issueResetLink(ctx.actor, ctx.actor.memberId);
    const session = await login(ctx.email, ctx.password);
    await access.resetPassword(issued.token, "NovaSenha99x");
    await expectHttp(verifyAccessToken(session.accessToken), 401);
    await expectHttp(access.resetPassword(issued.token, "OutraSenha99"), 400);
    const again = await login(ctx.email, "NovaSenha99x");
    assert.ok(again.accessToken);
    await access.resetPassword((await access.issueResetLink(ctx.actor, ctx.actor.memberId)).token, "SenhaValida10");
  });

  it("pedido de recuperação não revela se o e-mail existe", async () => {
    const a = await access.requestReset("naoexiste@e1.test.local");
    const b = await access.requestReset(ctx.email);
    assert.deepEqual(a, b);
  });
});

describe("RF27/29 equipe e setores", () => {
  it("cria setor e pessoa; desativar com ticket exige reassociação", async () => {
    const sector = await sectors.save(ctx.actor, { name: "Suporte", memberIds: [ctx.actor.memberId] });
    const created = await team.create(ctx.actor, {
      name: "Ana Atende",
      email: `ana-${runId}@e1.test.local`,
      password: "SenhaAgente10",
      roleId: ctx.agentRole.id,
      sectorIds: [sector.id],
    });
    const listed = await team.list(ctx.actor, new URLSearchParams());
    assert.ok(listed.data.some((row) => row.id === created.id));

    const started = await inbox.start(ctx.actor, { contactName: "Cliente A", contactPhone: "+55 11 91111-1001", text: "olá", sectorId: sector.id });
    await prisma.conversation.update({ where: { id: started.id }, data: { assignedMemberId: created.id } });
    await expectHttp(team.deactivate(ctx.actor, created.id, {}), 409);
    await team.deactivate(ctx.actor, created.id, { reassignToMemberId: ctx.actor.memberId });
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: started.id } });
    assert.equal(after.assignedMemberId, ctx.actor.memberId);
  });
});

describe("RF07 rodízio", () => {
  it("distribui conforme percentuais e não perde o ticket sem elegível", async () => {
    const sector = await sectors.save(ctx.actor, { name: "Comercial" });
    const a = await team.create(ctx.actor, { name: "Op A", email: `a-${runId}@e1.test.local`, password: "SenhaAgente10", roleId: ctx.agentRole.id, sectorIds: [sector.id] });
    const b = await team.create(ctx.actor, { name: "Op B", email: `b-${runId}@e1.test.local`, password: "SenhaAgente10", roleId: ctx.agentRole.id, sectorIds: [sector.id] });
    await prisma.teamPresence.createMany({
      data: [
        { tenantId: ctx.actor.tenantId, memberId: a.id, isOnline: true, status: "ONLINE", lastSeenAt: new Date() },
        { tenantId: ctx.actor.tenantId, memberId: b.id, isOnline: true, status: "ONLINE", lastSeenAt: new Date() },
      ],
    });
    await dist.saveRule(ctx.actor, {
      name: "50/50",
      sectorId: sector.id,
      participants: [
        { memberId: a.id, percent: 50 },
        { memberId: b.id, percent: 50 },
      ],
    });
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const started = await inbox.ingestInbound(ctx.actor.tenantId, {
        provider: "demo",
        providerEventId: `rr-${runId}-${i}`,
        contactName: `Lead ${i}`,
        contactPhone: `+55 11 92222-10${10 + i}`,
        text: "quero",
        sectorId: sector.id,
      });
      ids.push(started.conversationId!);
    }
    const owners = await prisma.conversation.findMany({ where: { id: { in: ids } }, select: { assignedMemberId: true } });
    const countA = owners.filter((row) => row.assignedMemberId === a.id).length;
    const countB = owners.filter((row) => row.assignedMemberId === b.id).length;
    assert.equal(countA, 2);
    assert.equal(countB, 2);

    await prisma.teamPresence.update({ where: { memberId: a.id }, data: { isOnline: false, status: "OFFLINE" } });
    await prisma.teamPresence.update({ where: { memberId: b.id }, data: { isOnline: false, status: "OFFLINE" } });
    const waiting = await inbox.ingestInbound(ctx.actor.tenantId, {
      provider: "demo",
      providerEventId: `rr-wait-${runId}`,
      contactName: "Lead espera",
      contactPhone: "+55 11 92222-1099",
      text: "fila",
      sectorId: sector.id,
    });
    const queued = await prisma.conversation.findUniqueOrThrow({ where: { id: waiting.conversationId! } });
    assert.equal(queued.assignedMemberId, null);
  });

  it("oito distribuições simultâneas do mesmo ticket geram um vencedor", async () => {
    const sector = await prisma.sector.findFirstOrThrow({ where: { tenantId: ctx.actor.tenantId, name: "Comercial" } });
    const created = await inbox.ingestInbound(ctx.actor.tenantId, {
      provider: "demo",
      providerEventId: `rr-race-${runId}`,
      contactName: "Corrida",
      contactPhone: "+55 11 93333-1000",
      text: "race",
      sectorId: sector.id,
    });
    await prisma.conversation.update({ where: { id: created.conversationId! }, data: { assignedMemberId: null } });
    await prisma.teamPresence.updateMany({
      where: { memberId: { in: (await prisma.sectorMember.findMany({ where: { sectorId: sector.id } })).map((s) => s.memberId) } },
      data: { isOnline: true, status: "ONLINE", lastSeenAt: new Date() },
    });
    const results = await Promise.all(Array.from({ length: 8 }, () => dist.distribute(ctx.actor.tenantId, created.conversationId!)));
    assert.equal(results.filter((row) => row.assigned).length, 1);
  });
});

describe("RF04 quadro ao vivo", () => {
  it("mover cartão não cria oportunidade nem muda setor", async () => {
    const sector = await prisma.sector.findFirstOrThrow({ where: { tenantId: ctx.actor.tenantId, name: "Suporte" } });
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: ctx.actor.tenantId, sectorId: sector.id },
    });
    const dealsBefore = await prisma.deal.count({ where: { tenantId: ctx.actor.tenantId } });
    const board = await boards.save(ctx.actor, { name: "Ao vivo E1" });
    const view = await boards.get(ctx.actor, board.id);
    await boards.addCard(ctx.actor, board.id, { conversationId: conversation.id, columnId: view.columns[0].id });
    const withCard = await boards.get(ctx.actor, board.id);
    const card = withCard.cards[0];
    await boards.moveCard(ctx.actor, board.id, card.id, { columnId: view.columns[1].id, position: 0, expectedVersion: card.version });
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    assert.equal(after.sectorId, conversation.sectorId);
    assert.equal(after.assignedMemberId, conversation.assignedMemberId);
    assert.equal(await prisma.deal.count({ where: { tenantId: ctx.actor.tenantId } }), dealsBefore);
  });
});

describe("RF03/06 inbox e lote", () => {
  it("encerramento com motivo obrigatório e lote com conflito", async () => {
    const sector = await sectors.save(ctx.actor, { name: "N1", requireCloseReason: true, memberIds: [ctx.actor.memberId] });
    const started = await inbox.start(ctx.actor, { contactName: "Zé", contactPhone: "+55 11 94444-1000", text: "ajuda", sectorId: sector.id });
    await expectHttp(inbox.close(ctx.actor, started.id, { expectedVersion: started.version }), 422);
    const closed = await inbox.close(ctx.actor, started.id, { reason: "resolved", expectedVersion: started.version });
    assert.equal(closed.closeReason, "resolved");

    const other = await inbox.start(ctx.actor, { contactName: "Lia", contactPhone: "+55 11 94444-1001", text: "lote", sectorId: sector.id });
    const preview = await ops.previewBatch(ctx.actor, [other.id]);
    assert.equal(preview.found, 1);
    const stale = other.version;
    await prisma.conversation.update({ where: { id: other.id }, data: { version: { increment: 1 } } });
    await expectHttp(inbox.close(ctx.actor, other.id, { reason: "resolved", expectedVersion: stale }), 409);
    const ran = await ops.runBatch(ctx.actor, { ids: [other.id], action: "close", reason: "resolved" });
    assert.equal(ran.results[0].ok, true);
  });
});

describe("RF30 auditoria sanitizada", () => {
  it("lista eventos da organização", async () => {
    const page = await ops.listAudit(ctx.actor, new URLSearchParams());
    assert.ok(page.total >= 1);
    assert.ok(page.data.every((row) => row.action));
  });
});
