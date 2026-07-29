import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContractsController } from "./contracts.controller";

const user = {
  sub: "user-id",
  email: "admin@example.com",
  name: "Admin",
  tenantId: "tenant-id",
  tenantName: "Tenant",
  memberId: "member-id",
  role: "Admin",
};

describe("ContractsController", () => {
  it("delegates list with parsed pagination to service", async () => {
    let received: unknown;
    const controller = new ContractsController({
      list: async (...args: unknown[]) => {
        received = args;
        return { data: [], total: 0, page: 1, limit: 25, totalPages: 1 };
      },
    } as never);

    await controller.list(user, "customer-1", "3", "25");

    assert.deepEqual(received, ["tenant-id", "customer-1", 3, 25]);
  });
});
