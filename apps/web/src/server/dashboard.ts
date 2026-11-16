import type { PrismaClient } from "@prisma/client";
import type { ServerAuthUser } from "./auth";
import { getPrisma } from "./prisma";
import { derivePresence } from "./inbox/rules";

/**
 * Indicadores calculados exclusivamente dos dados locais da organização.
 * Cada bloco informa `hasData`: ausência de amostra é diferente de falha (falha = erro HTTP).
 */
export class DashboardService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async overview(user: ServerAuthUser, query: URLSearchParams = new URLSearchParams(), now: Date = new Date()) {
    const tenantId = user.tenantId;
    const timezone = "America/Sao_Paulo";
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const from = query.get("from") ? new Date(query.get("from")!) : new Date(now.getTime() - 7 * 86_400_000);
    const to = query.get("to") ? new Date(query.get("to")!) : now;
    const window = { gte: from, lte: to };
    const sectorId = query.get("sectorId") || undefined;
    const operatorId = query.get("operatorId") || undefined;
    const channelId = query.get("channelId") || undefined;
    const convFilter = {
      tenantId,
      ...(sectorId ? { sectorId } : {}),
      ...(operatorId ? { assignedMemberId: operatorId } : {}),
      ...(channelId ? { channelIntegrationId: channelId } : {}),
    };
    const active = { in: ["OPEN", "PENDING"] as ("OPEN" | "PENDING")[] };

    const [queue, inProgress, closedToday, messagesToday, openedInWindow, closedInWindow, firstResponses, customers, customersByStatus, contractsByStatus, invoiceGroups, overdueOpen, dealsByStatus, agents, presence, birthdays] =
      await Promise.all([
        this.prisma.conversation.count({ where: { ...convFilter, status: active, assignedMemberId: null } }),
        this.prisma.conversation.count({ where: { ...convFilter, status: active, assignedMemberId: { not: null } } }),
        this.prisma.conversation.count({ where: { ...convFilter, status: "SOLVED", closedAt: { gte: startOfDay } } }),
        this.prisma.message.count({ where: { tenantId, createdAt: { gte: startOfDay }, direction: { in: ["INBOUND", "OUTBOUND"] } } }),
        this.prisma.conversation.count({ where: { ...convFilter, createdAt: window } }),
        this.prisma.conversation.count({ where: { ...convFilter, status: "SOLVED", closedAt: window } }),
        this.prisma.conversation.findMany({
          where: { ...convFilter, firstResponseAt: { not: null }, createdAt: window },
          select: { createdAt: true, firstResponseAt: true },
          take: 2000,
        }),
        this.prisma.customer.count({ where: { tenantId, deletedAt: null } }),
        this.prisma.customer.groupBy({ by: ["status"], where: { tenantId, deletedAt: null }, _count: { _all: true } }),
        this.prisma.contract.groupBy({ by: ["status"], where: { tenantId, deletedAt: null }, _count: { _all: true } }),
        this.prisma.invoice.groupBy({ by: ["status"], where: { tenantId, deletedAt: null }, _count: { _all: true }, _sum: { amountCents: true } }),
        this.prisma.invoice.aggregate({
          where: { tenantId, deletedAt: null, status: "OPEN", dueDate: { lt: startOfDay } },
          _count: { _all: true },
          _sum: { amountCents: true },
        }),
        this.prisma.deal.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
        this.prisma.aiAgent.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
        this.prisma.tenantMember.findMany({
          where: { tenantId, status: "ACTIVE", role: { permissions: { some: { permission: { code: "chat.reply" } } } } },
          include: { presence: true },
        }),
        this.prisma.customer.findMany({
          where: { tenantId, deletedAt: null },
          select: { id: true, name: true, metadata: true },
          take: 2000,
        }),
      ]);

    const tally = (rows: { status: string; _count: { _all: number } }[]) =>
      Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
    const sum = <T extends { _sum: { amountCents: number | null } }>(row?: T) => row?._sum.amountCents ?? 0;
    const invoiceBy = Object.fromEntries(invoiceGroups.map((g) => [g.status, { count: g._count._all, amountCents: sum(g) }]));
    const operators = presence.map((member) => derivePresence(member.presence, now));
    const invoiceTotal = invoiceGroups.reduce((acc, g) => acc + g._count._all, 0);

    const firstResponseSamples = firstResponses
      .map((row) => (row.firstResponseAt!.getTime() - row.createdAt.getTime()) / 1000)
      .filter((seconds) => seconds >= 0);
    const avgFirstResponseSeconds = firstResponseSamples.length
      ? Math.round(firstResponseSamples.reduce((a, b) => a + b, 0) / firstResponseSamples.length)
      : null;
    const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, month: "2-digit", day: "2-digit" }).format(now);
    const monthKey = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, month: "2-digit" }).format(now);
    const birthdayPeople = birthdays
      .map((row) => {
        const birthDate = typeof row.metadata === "object" && row.metadata && "birthDate" in row.metadata
          ? String((row.metadata as { birthDate?: string }).birthDate ?? "")
          : "";
        return { id: row.id, name: row.name, birthDate };
      })
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.birthDate));

    return {
      generatedAt: now.toISOString(),
      timezone,
      window: { from: from.toISOString(), to: to.toISOString() },
      definitions: {
        queue: "Atendimentos OPEN/PENDING sem responsável, no recorte de setor/canal/operador.",
        closedToday: "Encerrados com closedAt no dia UTC corrente (não confundir com ausência de amostra).",
        avgFirstResponseSeconds: "Média (s) de createdAt → firstResponseAt no período. Sem amostra = null, não zero.",
        birthdays: "Somente clientes com metadata.birthDate cadastrado (AAAA-MM-DD). Não inferido de documento.",
      },
      source: "local",
      conversations: {
        queue,
        inProgress,
        closedToday,
        messagesToday,
        openedInWindow,
        closedInWindow,
        avgFirstResponseSeconds,
        firstResponseSampleSize: firstResponseSamples.length,
        hasData: queue + inProgress + closedToday + messagesToday + openedInWindow > 0,
      },
      birthdays: {
        today: birthdayPeople.filter((row) => row.birthDate.slice(5) === todayKey),
        thisMonth: birthdayPeople.filter((row) => row.birthDate.slice(5, 7) === monthKey),
        hasData: birthdayPeople.length > 0,
      },
      customers: { total: customers, byStatus: tally(customersByStatus), hasData: customers > 0 },
      contracts: { byStatus: tally(contractsByStatus), hasData: contractsByStatus.length > 0 },
      invoices: {
        byStatus: invoiceBy,
        overdueOpen: { count: overdueOpen._count._all, amountCents: sum(overdueOpen) },
        hasData: invoiceTotal > 0,
      },
      deals: { byStatus: tally(dealsByStatus), hasData: dealsByStatus.length > 0 },
      aiAgents: { byStatus: tally(agents), hasData: agents.length > 0 },
      team: {
        online: operators.filter((s) => s === "ONLINE").length,
        away: operators.filter((s) => s === "AWAY").length,
        offline: operators.filter((s) => s === "OFFLINE").length,
        hasData: operators.length > 0,
      },
    };
  }
}

let singleton: DashboardService | null = null;
export function getDashboardService() {
  singleton ??= new DashboardService();
  return singleton;
}
