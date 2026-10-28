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

  async overview(user: ServerAuthUser, now: Date = new Date()) {
    const tenantId = user.tenantId;
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const active = { in: ["OPEN", "PENDING"] as ("OPEN" | "PENDING")[] };

    const [queue, inProgress, closedToday, messagesToday, customers, customersByStatus, contractsByStatus, invoiceGroups, overdueOpen, dealsByStatus, agents, presence] =
      await Promise.all([
        this.prisma.conversation.count({ where: { tenantId, status: active, assignedMemberId: null } }),
        this.prisma.conversation.count({ where: { tenantId, status: active, assignedMemberId: { not: null } } }),
        this.prisma.conversation.count({ where: { tenantId, status: "SOLVED", closedAt: { gte: startOfDay } } }),
        this.prisma.message.count({ where: { tenantId, createdAt: { gte: startOfDay }, direction: { in: ["INBOUND", "OUTBOUND"] } } }),
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
      ]);

    const tally = (rows: { status: string; _count: { _all: number } }[]) =>
      Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
    const sum = <T extends { _sum: { amountCents: number | null } }>(row?: T) => row?._sum.amountCents ?? 0;
    const invoiceBy = Object.fromEntries(invoiceGroups.map((g) => [g.status, { count: g._count._all, amountCents: sum(g) }]));
    const operators = presence.map((member) => derivePresence(member.presence, now));
    const invoiceTotal = invoiceGroups.reduce((acc, g) => acc + g._count._all, 0);

    return {
      generatedAt: now.toISOString(),
      source: "local",
      conversations: { queue, inProgress, closedToday, messagesToday, hasData: queue + inProgress + closedToday + messagesToday > 0 },
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
