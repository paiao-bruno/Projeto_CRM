import { Prisma, type PrismaClient } from "@prisma/client";
import type { ServerAuthUser } from "./auth";
import { recordAudit } from "./audit";
import { HttpError } from "./http";
import { isOpenAt, type WorkingHours } from "./hours";
import { derivePresence, PERMISSIONS } from "./inbox/rules";
import { publishEvent } from "./realtime";
import { getPrisma } from "./prisma";
import { requireUuid, requiredString, type Body } from "./validation";

export type Candidate = { memberId: string; percent: number; assignedInCycle: number; totalAssigned: number; eligible: boolean };

/**
 * Contrato do rodízio (decisão própria, documentada em docs/vertice/13):
 * - cada participante tem `percent` (1..100) e a soma é 100; o ciclo tem 100 atribuições e a quota é o percentual;
 * - escolhe-se, entre os ELEGÍVEIS com quota restante, o de menor razão atribuído/percentual;
 * - desempate: menos atribuições totais, depois menor memberId (determinístico);
 * - o ciclo fecha quando nenhum elegível tem quota restante: contadores zeram e o ciclo seguinte começa.
 *   A quota não usada de quem estava indisponível é perdida naquele ciclo (não gera dívida).
 */
export function pickNext(candidates: Candidate[]): { memberId: string | null; resetCycle: boolean } {
  const eligible = candidates.filter((c) => c.eligible && c.percent > 0);
  if (eligible.length === 0) return { memberId: null, resetCycle: false };
  let pool = eligible.filter((c) => c.assignedInCycle < c.percent);
  let resetCycle = false;
  let view = eligible;
  if (pool.length === 0) {
    resetCycle = true;
    view = eligible.map((c) => ({ ...c, assignedInCycle: 0 }));
    pool = view;
  }
  const best = [...pool].sort((a, b) => {
    const ratio = a.assignedInCycle * b.percent - b.assignedInCycle * a.percent;
    if (ratio !== 0) return ratio;
    if (a.totalAssigned !== b.totalAssigned) return a.totalAssigned - b.totalAssigned;
    return a.memberId.localeCompare(b.memberId);
  })[0];
  return { memberId: best.memberId, resetCycle };
}

export function validateParticipants(value: unknown): { memberId: string; percent: number }[] {
  if (!Array.isArray(value) || value.length === 0) throw new HttpError(422, "Informe ao menos um participante.");
  const seen = new Set<string>();
  const list = value.map((item) => {
    const memberId = requireUuid((item as Body)?.memberId, "memberId");
    const percent = Number((item as Body)?.percent);
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) throw new HttpError(422, "percent deve ser um inteiro entre 1 e 100.");
    if (seen.has(memberId)) throw new HttpError(422, "Participante repetido.");
    seen.add(memberId);
    return { memberId, percent };
  });
  const sum = list.reduce((total, item) => total + item.percent, 0);
  if (sum !== 100) throw new HttpError(422, `Os percentuais devem somar 100 (soma atual: ${sum}).`);
  return list;
}

type Tx = Prisma.TransactionClient;

export class DistributionService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async listRules(user: ServerAuthUser) {
    const rules = await this.prisma.roundRobinRule.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "asc" },
      include: { sector: { select: { id: true, name: true } }, fallback: { select: { id: true, name: true } }, participants: { include: { member: { select: { id: true, displayName: true, user: { select: { name: true } } } } } } },
    });
    return rules.map((rule) => ({
      id: rule.id, name: rule.name, active: rule.active, cycleNumber: rule.cycleNumber,
      sector: rule.sector, fallbackSector: rule.fallback,
      participants: rule.participants.map((p) => ({ memberId: p.memberId, name: p.member.displayName ?? p.member.user.name, percent: p.percent, assignedInCycle: p.assignedInCycle, totalAssigned: p.totalAssigned })),
    }));
  }

  private async assertScope(tx: Tx | PrismaClient, user: ServerAuthUser, sectorId: string, fallbackSectorId: string | null, participants: { memberId: string }[]) {
    const sectors = await tx.sector.findMany({ where: { tenantId: user.tenantId, id: { in: [sectorId, ...(fallbackSectorId ? [fallbackSectorId] : [])] }, archivedAt: null } });
    if (!sectors.some((s) => s.id === sectorId)) throw new HttpError(422, "Setor invalido.");
    if (fallbackSectorId && fallbackSectorId === sectorId) throw new HttpError(422, "O setor de fallback deve ser diferente do setor da regra.");
    if (fallbackSectorId && !sectors.some((s) => s.id === fallbackSectorId)) throw new HttpError(422, "Setor de fallback invalido.");
    const members = await tx.sectorMember.findMany({ where: { tenantId: user.tenantId, sectorId, memberId: { in: participants.map((p) => p.memberId) } } });
    if (members.length !== participants.length) throw new HttpError(422, "Todos os participantes devem pertencer ao setor da regra.");
  }

  async saveRule(user: ServerAuthUser, body: Body, id?: string) {
    const existing = id ? await this.prisma.roundRobinRule.findFirst({ where: { id: requireUuid(id), tenantId: user.tenantId } }) : null;
    if (id && !existing) throw new HttpError(404, "Regra nao encontrada.");
    const name = id && body.name === undefined ? existing!.name : requiredString(body, "name", 120);
    const sectorId = body.sectorId !== undefined ? requireUuid(body.sectorId, "sectorId") : existing?.sectorId;
    if (!sectorId) throw new HttpError(422, "sectorId e obrigatorio.");
    const fallbackSectorId = body.fallbackSectorId === undefined ? (existing?.fallbackSectorId ?? null) : body.fallbackSectorId === null ? null : requireUuid(body.fallbackSectorId, "fallbackSectorId");
    const active = body.active === undefined ? (existing?.active ?? true) : body.active === true;
    const participants = body.participants !== undefined ? validateParticipants(body.participants) : null;
    if (!id && !participants) throw new HttpError(422, "Informe os participantes.");

    return this.prisma.$transaction(async (tx) => {
      const current = participants ?? (await tx.roundRobinParticipant.findMany({ where: { ruleId: id! } }));
      await this.assertScope(tx, user, sectorId, fallbackSectorId, current);
      if (active) {
        const clash = await tx.roundRobinRule.findFirst({ where: { tenantId: user.tenantId, sectorId, active: true, ...(id ? { id: { not: id } } : {}) } });
        if (clash) throw new HttpError(409, "Ja existe uma regra ativa para este setor.");
      }
      const rule = id
        ? await tx.roundRobinRule.update({ where: { id }, data: { name, sectorId, fallbackSectorId, active, ...(participants ? { cycleNumber: { increment: 1 } } : {}) } })
        : await tx.roundRobinRule.create({ data: { tenantId: user.tenantId, name, sectorId, fallbackSectorId, active } });
      if (participants) {
        const previous = new Map((await tx.roundRobinParticipant.findMany({ where: { ruleId: rule.id } })).map((p) => [p.memberId, p]));
        await tx.roundRobinParticipant.deleteMany({ where: { ruleId: rule.id } });
        await tx.roundRobinParticipant.createMany({ data: participants.map((p) => ({ ruleId: rule.id, memberId: p.memberId, percent: p.percent, assignedInCycle: 0, totalAssigned: previous.get(p.memberId)?.totalAssigned ?? 0 })) });
      }
      await recordAudit(tx, user, id ? "round_robin.updated" : "round_robin.created", "RoundRobinRule", rule.id, { name, sectorId, active });
      return rule;
    });
  }

  async removeRule(user: ServerAuthUser, id: string) {
    const result = await this.prisma.roundRobinRule.deleteMany({ where: { id: requireUuid(id), tenantId: user.tenantId } });
    if (result.count === 0) throw new HttpError(404, "Regra nao encontrada.");
    await recordAudit(this.prisma, user, "round_robin.deleted", "RoundRobinRule", id);
    return { ok: true };
  }

  /**
   * Distribui UMA conversa da fila conforme a regra ativa do setor. Nunca descarta: sem elegível a conversa
   * continua na fila (ou segue para o setor de fallback, uma única vez por chamada).
   */
  async distribute(tenantId: string, conversationId: string, now: Date = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.findFirst({ where: { id: conversationId, tenantId } });
      if (!conversation || conversation.assignedMemberId || !["OPEN", "PENDING"].includes(conversation.status) || !conversation.sectorId) {
        return { assigned: false as const, reason: "not_applicable" };
      }
      const rule = await tx.roundRobinRule.findFirst({ where: { tenantId, sectorId: conversation.sectorId, active: true } });
      if (!rule) return { assigned: false as const, reason: "no_rule" };
      await tx.$queryRaw`SELECT id FROM "RoundRobinRule" WHERE id = ${rule.id}::uuid FOR UPDATE`;
      const fresh = await tx.conversation.findFirst({ where: { id: conversationId, tenantId, assignedMemberId: null } });
      if (!fresh) return { assigned: false as const, reason: "already_assigned" };

      const sector = await tx.sector.findFirstOrThrow({ where: { id: conversation.sectorId, tenantId } });
      const open = isOpenAt(sector.workingHours as WorkingHours | null, sector.timezone, now);
      const participants = await tx.roundRobinParticipant.findMany({
        where: { ruleId: rule.id },
        include: { member: { include: { presence: true, role: { include: { permissions: { include: { permission: true } } } }, sectorLinks: { where: { sectorId: sector.id } } } } },
      });
      const load = await tx.conversation.groupBy({
        by: ["assignedMemberId"],
        where: { tenantId, status: { in: ["OPEN", "PENDING"] }, assignedMemberId: { in: participants.map((p) => p.memberId) } },
        _count: { _all: true },
      });
      const active = new Map(load.map((row) => [row.assignedMemberId, row._count._all]));
      const candidates: Candidate[] = participants.map((p) => {
        const m = p.member;
        const canReply = m.role?.permissions.some((rp) => rp.permission.code === PERMISSIONS.reply) ?? false;
        const capacityOk = m.maxActiveConversations == null || (active.get(m.id) ?? 0) < m.maxActiveConversations;
        const eligible = open && m.status === "ACTIVE" && canReply && m.sectorLinks.length > 0 && capacityOk && derivePresence(m.presence, now) === "ONLINE";
        return { memberId: m.id, percent: p.percent, assignedInCycle: p.assignedInCycle, totalAssigned: p.totalAssigned, eligible };
      });

      const pick = pickNext(candidates);
      if (!pick.memberId) {
        if (rule.fallbackSectorId && rule.fallbackSectorId !== conversation.sectorId) {
          const fallback = await tx.sector.findFirst({ where: { id: rule.fallbackSectorId, tenantId, archivedAt: null, active: true } });
          if (fallback) {
            await tx.conversation.update({ where: { id: conversationId }, data: { sectorId: fallback.id, version: { increment: 1 } } });
            await tx.conversationEvent.create({ data: { tenantId, conversationId, type: "FALLBACK", data: { ruleId: rule.id, fromSectorId: sector.id, toSectorId: fallback.id, reason: open ? "no_eligible_member" : "outside_working_hours" } } });
            await publishEvent(tx, { type: "conversation.fallback", tenantId, conversationId });
            return { assigned: false as const, reason: "fallback", sectorId: fallback.id };
          }
        }
        return { assigned: false as const, reason: open ? "no_eligible_member" : "outside_working_hours" };
      }

      if (pick.resetCycle) {
        await tx.roundRobinParticipant.updateMany({ where: { ruleId: rule.id }, data: { assignedInCycle: 0 } });
        await tx.roundRobinRule.update({ where: { id: rule.id }, data: { cycleNumber: { increment: 1 } } });
      }
      const claimed = await tx.conversation.updateMany({
        where: { id: conversationId, tenantId, assignedMemberId: null },
        data: { assignedMemberId: pick.memberId, claimedAt: now, version: { increment: 1 } },
      });
      if (claimed.count !== 1) return { assigned: false as const, reason: "already_assigned" };
      await tx.roundRobinParticipant.update({ where: { ruleId_memberId: { ruleId: rule.id, memberId: pick.memberId } }, data: { assignedInCycle: { increment: 1 }, totalAssigned: { increment: 1 } } });
      await tx.conversationEvent.create({ data: { tenantId, conversationId, type: "DISTRIBUTED", actorMemberId: null, data: { ruleId: rule.id, memberId: pick.memberId, cycle: pick.resetCycle ? rule.cycleNumber + 1 : rule.cycleNumber } } });
      await publishEvent(tx, { type: "conversation.distributed", tenantId, conversationId });
      return { assigned: true as const, memberId: pick.memberId };
    }, { timeout: 15_000 });
  }

  /** Percorre a fila (mais antigas primeiro) do tenant e tenta distribuir cada conversa. */
  async distributeQueue(tenantId: string, limit = 50, now: Date = new Date()) {
    const queue = await this.prisma.conversation.findMany({
      where: { tenantId, assignedMemberId: null, status: { in: ["OPEN", "PENDING"] }, sectorId: { not: null } },
      orderBy: { createdAt: "asc" }, take: Math.min(limit, 200), select: { id: true },
    });
    const results = { examined: queue.length, assigned: 0, fallback: 0, waiting: 0 };
    for (const item of queue) {
      const outcome = await this.distribute(tenantId, item.id, now);
      if (outcome.assigned) results.assigned += 1;
      else if (outcome.reason === "fallback") results.fallback += 1;
      else results.waiting += 1;
    }
    return results;
  }
}

let singleton: DistributionService | null = null;
export function getDistributionService() {
  singleton ??= new DistributionService();
  return singleton;
}
