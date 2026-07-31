import assert from "node:assert/strict";
import { DealStatus } from "@prisma/client";
import { describe, it } from "node:test";
import { SalesFunnelMetricsService } from "./sales-funnel-metrics.service";
import { SALES_FUNNEL_STAGE_CODES } from "../../../../../shared/sales-funnel.constants";

describe("SalesFunnelMetricsService", () => {
  it("returns null conversion when there are no created deals", async () => {
    const prisma = {
      deal: {
        count: async () => 0,
        groupBy: async () => [],
        aggregate: async () => ({ _sum: { valueCents: 0 } }),
      },
      pipelineStage: {
        findMany: async () => [
          {
            id: "stage-1",
            code: SALES_FUNNEL_STAGE_CODES.PROSPECCAO,
            name: "Prospecção",
            position: 1,
          },
        ],
      },
      dealHistory: {
        count: async () => 0,
      },
      tenantMember: {
        findMany: async () => [],
      },
    };

    const service = new SalesFunnelMetricsService(prisma as never);
    const metrics = await service.getMetrics("tenant-a", {});

    assert.equal(metrics.totals.overallConversionRate, null);
    assert.equal(metrics.totals.open, 0);
    assert.equal(metrics.stageConversion[0]?.rate, null);
  });

  it("calculates open totals and segments", async () => {
    const prisma = {
      deal: {
        count: async ({ where }: { where: { status?: DealStatus; ownerMemberId?: null } }) => {
          if (where.status === DealStatus.OPEN && where.ownerMemberId === null) return 2;
          if (where.status === DealStatus.OPEN) return 5;
          if (where.status === DealStatus.WON) return 1;
          if (where.status === DealStatus.LOST) return 1;
          return 7;
        },
        groupBy: async ({ by }: { by: string[] }) => {
          if (by[0] === "stageId") {
            return [{ stageId: "stage-1", _count: { _all: 3 } }];
          }
          if (by[0] === "entrySource") {
            return [{ entrySource: "WhatsApp", _count: { _all: 2 } }];
          }
          if (by[0] === "ownerMemberId") {
            return [{ ownerMemberId: "member-1", _count: { _all: 2 } }];
          }
          return [];
        },
        aggregate: async () => ({ _sum: { valueCents: 150000 } }),
      },
      pipelineStage: {
        findMany: async () => [
          {
            id: "stage-1",
            code: SALES_FUNNEL_STAGE_CODES.PROSPECCAO,
            name: "Prospecção",
            position: 1,
          },
          {
            id: "stage-2",
            code: SALES_FUNNEL_STAGE_CODES.VIABILIDADE,
            name: "Viabilidade",
            position: 2,
          },
        ],
      },
      dealHistory: {
        count: async () => 2,
      },
      tenantMember: {
        findMany: async () => [
          {
            id: "member-1",
            displayName: "Vendedor A",
            user: { name: "Vendedor A" },
          },
        ],
      },
    };

    const service = new SalesFunnelMetricsService(prisma as never);
    const metrics = await service.getMetrics("tenant-a", {});

    assert.equal(metrics.totals.open, 5);
    assert.equal(metrics.totals.withoutOwner, 2);
    assert.equal(metrics.totals.estimatedValueCents, 150000);
    assert.equal(metrics.totals.overallConversionRate, 2 / 7);
    assert.equal(metrics.segments.entrySource[0]?.key, "WhatsApp");
    assert.equal(metrics.segments.owner[0]?.key, "Vendedor A");
  });
});
