import { Injectable, NotFoundException } from "@nestjs/common";
import { IntegrationSyncStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { ListSgpSyncHistoryDto } from "../dto/list-sgp-sync-history.dto";
import { mapSgpSyncHistoryEntry } from "./sgp-sync-history.mapper";
import { SgpSyncHistoryListResponse } from "./sgp-sync-history.types";

const historyInclude = {
  tenant: {
    select: {
      id: true,
      name: true,
    },
  },
  triggeredBy: {
    select: {
      id: true,
      displayName: true,
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  },
} satisfies Prisma.IntegrationSyncRunInclude;

@Injectable()
export class SgpSyncHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: ListSgpSyncHistoryDto = {}): Promise<SgpSyncHistoryListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.IntegrationSyncRunWhereInput = {
      tenantId,
      operation: "sgp.sync-customers",
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            startedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [total, runs] = await this.prisma.$transaction([
      this.prisma.integrationSyncRun.count({ where }),
      this.prisma.integrationSyncRun.findMany({
        where,
        include: historyInclude,
        orderBy: { startedAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return {
      items: runs.map(mapSgpSyncHistoryEntry),
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async getById(tenantId: string, id: string) {
    const run = await this.prisma.integrationSyncRun.findFirst({
      where: {
        id,
        tenantId,
        operation: "sgp.sync-customers",
      },
      include: {
        ...historyInclude,
        logs: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!run) {
      throw new NotFoundException("Execução de sincronização não encontrada.");
    }

    return {
      ...mapSgpSyncHistoryEntry(run),
      logs: run.logs.map((log) => ({
        id: log.id,
        entity: log.entity,
        externalId: log.externalId,
        action: log.action,
        status: log.status,
        message: log.message,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }

  async getLatest(tenantId: string) {
    const run = await this.prisma.integrationSyncRun.findFirst({
      where: {
        tenantId,
        operation: "sgp.sync-customers",
      },
      include: historyInclude,
      orderBy: { startedAt: "desc" },
    });

    return run ? mapSgpSyncHistoryEntry(run) : null;
  }

  async markFailed(
    tenantId: string,
    runId: string,
    input: {
      errorMessage: string;
      stackTrace?: string;
      status?: IntegrationSyncStatus;
    },
  ) {
    await this.prisma.integrationSyncRun.updateMany({
      where: {
        id: runId,
        tenantId,
      },
      data: {
        status: input.status ?? IntegrationSyncStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: input.errorMessage,
        stackTrace: input.stackTrace,
      },
    });
  }
}
