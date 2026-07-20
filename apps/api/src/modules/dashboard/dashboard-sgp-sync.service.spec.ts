import assert from "node:assert/strict";
import { IntegrationSyncStatus } from "@prisma/client";
import { describe, it } from "node:test";
import { DashboardSgpSyncService } from "./dashboard-sgp-sync.service";

function createPrismaMock() {
  const latestRun = {
    id: "run-latest",
    tenantId: "tenant-1",
    integrationId: "integration-1",
    triggeredById: "member-1",
    operation: "sgp.sync-customers",
    status: IntegrationSyncStatus.COMPLETED,
    syncMode: "incremental",
    trigger: "manual",
    startedAt: new Date("2026-07-20T10:00:00.000Z"),
    finishedAt: new Date("2026-07-20T10:05:00.000Z"),
    durationMs: 300_000,
    processed: 10,
    created: 8,
    updated: 2,
    ignored: 1,
    errorsCount: 0,
    customersProcessed: 10,
    customersCreated: 2,
    customersUpdated: 1,
    customersDeleted: 0,
    customersIgnored: 1,
    contractsProcessed: 6,
    contractsCreated: 3,
    contractsUpdated: 1,
    contractsDeleted: 0,
    contractsIgnored: 0,
    invoicesProcessed: 4,
    invoicesCreated: 3,
    invoicesUpdated: 1,
    invoicesDeleted: 0,
    invoicesIgnored: 0,
    errors: null,
    stackTrace: null,
    cursor: null,
    errorMessage: null,
    metadata: null,
    tenant: { id: "tenant-1", name: "Empresa Demo" },
    triggeredBy: {
      id: "member-1",
      displayName: "Admin",
      user: { name: "Administrador", email: "admin@example.com" },
    },
  };

  return {
    integrationSyncRun: {
      findFirst: async ({
        where,
      }: {
        where: { status?: IntegrationSyncStatus | { not: IntegrationSyncStatus } };
      }) => {
        if (where.status === IntegrationSyncStatus.RUNNING) {
          return null;
        }
        if (
          typeof where.status === "object" &&
          where.status?.not === IntegrationSyncStatus.RUNNING
        ) {
          return latestRun;
        }
        return latestRun;
      },
      findMany: async () => [latestRun],
      aggregate: async () => ({
        _avg: { durationMs: 300_000 },
        _count: { _all: 1 },
      }),
    },
    integration: {
      findMany: async () => [
        {
          status: "ACTIVE",
          healthStatus: "HEALTHY",
          lastError: null,
          name: "SGP",
          config: { autoSync: { enabled: true } },
        },
      ],
    },
  };
}

describe("DashboardSgpSyncService", () => {
  it("returns dashboard sync overview with last sync, average duration and history", async () => {
    const service = new DashboardSgpSyncService(createPrismaMock() as never);
    const overview = await service.getOverview("tenant-1");

    assert.equal(overview.lastSync?.durationMs, 300_000);
    assert.equal(overview.recordCount, 20);
    assert.equal(overview.averageDurationMs, 300_000);
    assert.equal(overview.runningSync, null);
    assert.equal(overview.recentHistory.length, 1);
    assert.ok(overview.health.some((item) => item.label === "Credenciais SGP"));
  });
});
