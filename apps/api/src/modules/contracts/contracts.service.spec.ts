import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContractsService } from "./contracts.service";

describe("ContractsService", () => {
  it("returns paginated contracts scoped to tenant", async () => {
    const service = new ContractsService({
      contract: {
        async findMany({ skip, take }: { skip: number; take: number }) {
          return Array.from({ length: take }, (_, index) => ({
            id: `contract-${skip + index + 1}`,
          }));
        },
        async count() {
          return 120;
        },
      },
    } as never);

    const result = await service.list("tenant-id", undefined, 2, 50);

    assert.equal(result.page, 2);
    assert.equal(result.limit, 50);
    assert.equal(result.total, 120);
    assert.equal(result.totalPages, 3);
    assert.equal(result.data.length, 50);
  });

  it("filters by customerId when provided", async () => {
    let receivedWhere: unknown;
    const service = new ContractsService({
      contract: {
        async findMany({ where }: { where: Record<string, unknown> }) {
          receivedWhere = where;
          return [];
        },
        async count({ where }: { where: Record<string, unknown> }) {
          receivedWhere = where;
          return 0;
        },
      },
    } as never);

    await service.list("tenant-id", "customer-id", 1, 10);

    assert.deepEqual(receivedWhere, {
      tenantId: "tenant-id",
      deletedAt: null,
      customerId: "customer-id",
    });
  });
});
