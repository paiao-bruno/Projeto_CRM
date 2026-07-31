import assert from "node:assert/strict";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { DealStatus } from "@prisma/client";
import { describe, it } from "node:test";
import { SalesFunnelService } from "./sales-funnel.service";
import { SALES_FUNNEL_STAGE_CODES } from "../../shared/sales-funnel.constants";

const tenantId = "tenant-a";
const memberId = "member-a";
const user = {
  sub: "user-a",
  email: "a@test.local",
  name: "User A",
  tenantId,
  tenantName: "Tenant A",
  memberId,
  role: "Administrador",
};

function createService() {
  const stages = [
    {
      id: "stage-1",
      tenantId,
      pipelineId: "pipeline-1",
      code: SALES_FUNNEL_STAGE_CODES.PROSPECCAO,
      name: "Prospecção",
      position: 1,
      color: "#64748b",
    },
    {
      id: "stage-2",
      tenantId,
      pipelineId: "pipeline-1",
      code: SALES_FUNNEL_STAGE_CODES.ATIVACAO,
      name: "Ativação",
      position: 6,
      color: "#22c55e",
    },
  ];

  const deals: Array<{
    id: string;
    tenantId: string;
    pipelineId: string;
    stageId: string;
    title: string;
    status: DealStatus;
    position: number;
    version: number;
    archivedAt: Date | null;
    wonAt: Date | null;
  }> = [
    {
      id: "deal-1",
      tenantId,
      pipelineId: "pipeline-1",
      stageId: "stage-1",
      title: "Cliente Teste",
      status: DealStatus.OPEN,
      position: 0,
      version: 1,
      archivedAt: null,
      wonAt: null,
    },
  ];

  const history: Array<Record<string, unknown>> = [];

  // Mock Prisma client for isolated unit tests.
  let prisma: any;
  prisma = {
    pipeline: {
      async findFirst({ where, include }: { where: { tenantId: string; isDefault?: boolean }; include?: { stages: boolean } }) {
        if (where.tenantId !== tenantId || !where.isDefault) return null;
        return include?.stages
          ? {
              id: "pipeline-1",
              tenantId,
              name: "Funil de Vendas",
              isDefault: true,
              stages,
            }
          : {
              id: "pipeline-1",
              tenantId,
              name: "Funil de Vendas",
              isDefault: true,
            };
      },
      async findFirstOrThrow({ where, include }: { where: { id: string }; include?: { stages: boolean } }) {
        return {
          id: where.id,
          tenantId,
          name: "Funil de Vendas",
          isDefault: true,
          stages,
        };
      },
      async create() {
        return {
          id: "pipeline-1",
          tenantId,
          name: "Funil de Vendas",
          isDefault: true,
          stages,
        };
      },
    },
    pipelineStage: {
      async update() {
        return stages[0];
      },
    },
    deal: {
      async findMany({ where }: { where: { pipelineId?: string; tenantId?: string; stageId?: string } }) {
        return deals.filter(
          (deal) =>
            deal.tenantId === where.tenantId &&
            (!where.pipelineId || deal.pipelineId === where.pipelineId) &&
            (!where.stageId || deal.stageId === where.stageId),
        );
      },
      async findFirst({ where }: { where: { id?: string; tenantId?: string; stageId?: string } }) {
        if (where.stageId && where.tenantId) {
          return deals
            .filter((deal) => deal.stageId === where.stageId && deal.tenantId === where.tenantId)
            .sort((a, b) => b.position - a.position)[0] ?? null;
        }
        return deals.find(
          (deal) => deal.id === where.id && deal.tenantId === where.tenantId,
        ) ?? null;
      },
      async count() {
        return deals.length;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const created = {
          id: "deal-new",
          ...data,
          stage: stages[0],
          ownerMember: null,
        };
        deals.push(created as never);
        return created;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const deal = deals.find((item) => item.id === where.id);
        Object.assign(deal!, data);
        return {
          ...deal,
          stage: stages.find((stage) => stage.id === deal!.stageId),
          ownerMember: null,
        };
      },
      async updateMany() {
        return { count: 1 };
      },
    },
    dealHistory: {
      async create({ data }: { data: Record<string, unknown> }) {
        history.push(data);
        return data;
      },
    },
    $transaction: async (callback: (tx: typeof prisma) => Promise<void>) => callback(prisma),
  };

  return { service: new SalesFunnelService(prisma as never), deals, history, stages };
}

describe("SalesFunnelService", () => {
  it("creates a deal in the default pipeline", async () => {
    const { service, history } = createService();
    const deal = await service.createDeal(user, { title: "Nova oportunidade" });
    assert.equal(deal.title, "Nova oportunidade");
    assert.equal(history.at(-1)?.action, "created");
  });

  it("rejects updates when version conflicts", async () => {
    const { service } = createService();
    await assert.rejects(
      () => service.updateDeal(user, "deal-1", { title: "Novo nome", version: 99 }),
      ConflictException,
    );
  });

  it("blocks editing archived deals", async () => {
    const { service, deals } = createService();
    deals[0].archivedAt = new Date();
    await assert.rejects(
      () => service.updateDeal(user, "deal-1", { title: "Novo nome", version: 1 }),
      ForbiddenException,
    );
  });

  it("requires loss reason when marking as lost", async () => {
    const { service } = createService();
    await assert.rejects(
      () => service.markLost(user, "deal-1", { lossReason: "   ", version: 1 }),
      (error: Error & { response?: { message?: string } }) => {
        assert.match(String(error.message ?? error), /motivo/i);
        return true;
      },
    );
  });

  it("records history when moving deals", async () => {
    const { service, history } = createService();
    await service.moveDeal(user, "deal-1", {
      stageId: "stage-2",
      position: 0,
      version: 1,
    });
    assert.equal(history.at(-1)?.action, "stage_changed");
  });

  it("isolates deals by tenant on read", async () => {
    const { service, deals } = createService();
    deals.push({
      id: "deal-other",
      tenantId: "tenant-b",
      pipelineId: "pipeline-1",
      stageId: "stage-1",
      title: "Outro tenant",
      status: DealStatus.OPEN,
      position: 0,
      version: 1,
      archivedAt: null,
      wonAt: null,
    });

    await assert.rejects(
      () => service.getDeal(user, "deal-other"),
      (error: Error) => {
        assert.match(error.message, /não encontrada/i);
        return true;
      },
    );
  });
});
