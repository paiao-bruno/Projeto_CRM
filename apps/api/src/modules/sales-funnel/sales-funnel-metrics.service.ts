import { Injectable } from "@nestjs/common";
import { DealPriority, DealStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import {
  SALES_FUNNEL_METRICS_DOC,
  SALES_FUNNEL_STAGE_CODES,
  SALES_FUNNEL_STAGES,
} from "../../shared/sales-funnel.constants";
import { ListDealsQueryDto } from "./dto/list-deals-query.dto";

@Injectable()
export class SalesFunnelMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(tenantId: string, query: ListDealsQueryDto) {
    const createdFrom = query.createdFrom ? new Date(query.createdFrom) : undefined;
    const createdTo = query.createdTo ? new Date(query.createdTo) : undefined;

    const baseWhere: Prisma.DealWhereInput = {
      tenantId,
      archivedAt: null,
      ...(createdFrom || createdTo
        ? {
            createdAt: {
              ...(createdFrom ? { gte: createdFrom } : {}),
              ...(createdTo ? { lte: createdTo } : {}),
            },
          }
        : {}),
      ...(query.ownerMemberId ? { ownerMemberId: query.ownerMemberId } : {}),
      ...(query.entrySource ? { entrySource: query.entrySource } : {}),
      ...(query.clientType ? { clientType: query.clientType } : {}),
      ...(query.contactType ? { contactType: query.contactType } : {}),
      ...(query.city ? { city: query.city } : {}),
      ...(query.neighborhood ? { neighborhood: query.neighborhood } : {}),
      ...(query.priority ? { priority: query.priority as DealPriority } : {}),
    };

    const [openCount, wonCount, lostCount, overdueNextAction, withoutOwner, byStage, estimatedValue] =
      await Promise.all([
        this.prisma.deal.count({ where: { ...baseWhere, status: DealStatus.OPEN } }),
        this.prisma.deal.count({ where: { ...baseWhere, status: DealStatus.WON } }),
        this.prisma.deal.count({ where: { ...baseWhere, status: DealStatus.LOST } }),
        this.prisma.deal.count({
          where: {
            ...baseWhere,
            status: DealStatus.OPEN,
            nextActionAt: { lt: new Date() },
          },
        }),
        this.prisma.deal.count({
          where: { ...baseWhere, status: DealStatus.OPEN, ownerMemberId: null },
        }),
        this.prisma.deal.groupBy({
          by: ["stageId"],
          where: { ...baseWhere, status: DealStatus.OPEN },
          _count: { _all: true },
        }),
        this.prisma.deal.aggregate({
          where: { ...baseWhere, status: DealStatus.OPEN },
          _sum: { valueCents: true },
        }),
      ]);

    const stages = await this.prisma.pipelineStage.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true, position: true },
      orderBy: { position: "asc" },
    });

    const createdInPeriod = await this.prisma.deal.count({ where: baseWhere });
    const activatedInPeriod = await this.prisma.dealHistory.count({
      where: {
        tenantId,
        action: "stage_changed",
        createdAt: {
          ...(createdFrom ? { gte: createdFrom } : {}),
          ...(createdTo ? { lte: createdTo } : {}),
        },
        newValue: {
          path: ["stageCode"],
          equals: SALES_FUNNEL_STAGE_CODES.ATIVACAO,
        },
      },
    });

    const stageCounts = SALES_FUNNEL_STAGES.map((definition) => {
      const stage = stages.find((item) => item.code === definition.code);
      const grouped = byStage.find((item) => item.stageId === stage?.id);
      return {
        code: definition.code,
        name: definition.name,
        count: grouped?._count._all ?? 0,
      };
    });

    const stageConversion = SALES_FUNNEL_STAGES.slice(0, -1).map((stage, index) => {
      const next = SALES_FUNNEL_STAGES[index + 1];
      const reachedCurrent = stageCounts.find((item) => item.code === stage.code)?.count ?? 0;
      const reachedNext = stageCounts.find((item) => item.code === next.code)?.count ?? 0;
      return {
        from: stage.name,
        to: next.name,
        rate: reachedCurrent > 0 ? reachedNext / reachedCurrent : null,
      };
    });

    return {
      definitions: SALES_FUNNEL_METRICS_DOC,
      totals: {
        open: openCount,
        won: wonCount,
        lost: lostCount,
        createdInPeriod,
        activatedInPeriod,
        overdueNextAction,
        withoutOwner,
        estimatedValueCents: estimatedValue._sum.valueCents ?? 0,
        overallConversionRate:
          createdInPeriod > 0 ? activatedInPeriod / createdInPeriod : null,
      },
      byStage: stageCounts,
      stageConversion,
      segments: {
        entrySource: await this.segmentByField(tenantId, "entrySource", baseWhere),
        clientType: await this.segmentByField(tenantId, "clientType", baseWhere),
        contactType: await this.segmentByField(tenantId, "contactType", baseWhere),
        city: await this.segmentByField(tenantId, "city", baseWhere),
        neighborhood: await this.segmentByField(tenantId, "neighborhood", baseWhere),
        owner: await this.segmentByOwner(tenantId, baseWhere),
      },
    };
  }

  private async segmentByField(
    tenantId: string,
    field: "entrySource" | "clientType" | "contactType" | "city" | "neighborhood",
    baseWhere: Prisma.DealWhereInput,
  ) {
    const rows = await this.prisma.deal.groupBy({
      by: [field],
      where: { ...baseWhere, status: DealStatus.OPEN, [field]: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 20,
    });

    return rows.map((row) => ({
      key: String(row[field] ?? "Sem valor"),
      count: row._count?._all ?? 0,
    }));
  }

  private async segmentByOwner(tenantId: string, baseWhere: Prisma.DealWhereInput) {
    const rows = await this.prisma.deal.groupBy({
      by: ["ownerMemberId"],
      where: { ...baseWhere, status: DealStatus.OPEN },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 20,
    });

    const members = await this.prisma.tenantMember.findMany({
      where: { tenantId, id: { in: rows.map((row) => row.ownerMemberId).filter(Boolean) as string[] } },
      select: { id: true, displayName: true, user: { select: { name: true } } },
    });

    return rows.map((row) => {
      const member = members.find((item) => item.id === row.ownerMemberId);
      return {
        key: member?.displayName ?? member?.user.name ?? "Sem responsável",
        count: row._count?._all ?? 0,
      };
    });
  }
}
