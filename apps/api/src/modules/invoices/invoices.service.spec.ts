import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvoicesService } from "./invoices.service";

describe("InvoicesService", () => {
  it("returns paginated invoices scoped to tenant", async () => {
    const service = new InvoicesService({
      invoice: {
        async findMany({ skip, take }: { skip: number; take: number }) {
          return Array.from({ length: take }, (_, index) => ({
            id: `invoice-${skip + index + 1}`,
          }));
        },
        async count() {
          return 250;
        },
      },
    } as never);

    const result = await service.list("tenant-id", undefined, 1, 100);

    assert.equal(result.total, 250);
    assert.equal(result.totalPages, 3);
    assert.equal(result.data.length, 100);
  });
});
