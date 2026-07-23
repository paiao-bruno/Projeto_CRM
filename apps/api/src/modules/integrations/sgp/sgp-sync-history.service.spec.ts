import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { describe, it } from "node:test";
import { SgpSyncHistoryService } from "./sgp-sync-history.service";

describe("SgpSyncHistoryService", () => {
  it("lists sync runs with pagination metadata", async () => {
    const service = new SgpSyncHistoryService({
      $transaction: async (queries: Array<Promise<unknown>>) => Promise.all(queries),
      integrationSyncRun: {
        async count() {
          return 45;
        },
        async findMany({ skip, take }: { skip: number; take: number }) {
          return Array.from({ length: take }, (_, index) => ({
            id: `run-${skip + index + 1}`,
            tenantId: "tenant-id",
            operation: "sgp.sync-customers",
            status: "COMPLETED",
            startedAt: new Date("2026-07-20T10:00:00.000Z"),
            finishedAt: new Date("2026-07-20T10:05:00.000Z"),
            processed: 10,
            created: 1,
            updated: 2,
            ignored: 7,
            errorsCount: 0,
            durationMs: 1000,
            metadata: null,
            tenant: { id: "tenant-id", name: "Tenant" },
            triggeredBy: null,
          }));
        },
      },
    } as never);

    const result = await service.list("tenant-id", { page: 2, limit: 20 });

    assert.equal(result.page, 2);
    assert.equal(result.limit, 20);
    assert.equal(result.total, 45);
    assert.equal(result.totalPages, 3);
    assert.equal(result.items.length, 20);
  });

  it("throws when sync run is not found for tenant", async () => {
    const service = new SgpSyncHistoryService({
      integrationSyncRun: {
        async findFirst() {
          return null;
        },
      },
    } as never);

    await assert.rejects(
      () => service.getById("tenant-id", "missing-run"),
      NotFoundException,
    );
  });
});
