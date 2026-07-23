import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CustomersController } from "./customers.controller";

const user = {
  sub: "user-id",
  email: "admin@example.com",
  name: "Admin",
  tenantId: "tenant-id",
  tenantName: "Tenant",
  memberId: "member-id",
  role: "Admin",
};

describe("CustomersController", () => {
  it("passes parsed pagination params to service.list", async () => {
    let received: unknown;
    const controller = new CustomersController({
      list: async (...args: unknown[]) => {
        received = args;
        return { data: [], total: 0, page: 2, limit: 50, totalPages: 1 };
      },
    } as never);

    await controller.list(user, "foo", "2", "50");

    assert.deepEqual(received, ["tenant-id", "foo", 2, 50]);
  });

  it("defaults invalid pagination values", async () => {
    let received: unknown;
    const controller = new CustomersController({
      list: async (...args: unknown[]) => {
        received = args;
        return { data: [], total: 0, page: 1, limit: 100, totalPages: 1 };
      },
    } as never);

    await controller.list(user, undefined, "0", "9999");

    assert.deepEqual(received, ["tenant-id", undefined, 1, 500]);
  });

  it("delegates CRUD endpoints to service", async () => {
    const calls: string[] = [];
    const controller = new CustomersController({
      list: async () => ({}),
      get: async () => {
        calls.push("get");
        return { id: "c1" };
      },
      create: async () => {
        calls.push("create");
        return { id: "c1" };
      },
      update: async () => {
        calls.push("update");
        return { id: "c1" };
      },
      remove: async () => {
        calls.push("remove");
        return { id: "c1" };
      },
      listContracts: async () => {
        calls.push("contracts");
        return [];
      },
      listInvoices: async () => {
        calls.push("invoices");
        return [];
      },
    } as never);

    await controller.get(user, "c1");
    await controller.create(user, { name: "Cliente" });
    await controller.update(user, "c1", { name: "Atualizado" });
    await controller.remove(user, "c1");
    await controller.listContracts(user, "c1");
    await controller.listInvoices(user, "c1");

    assert.deepEqual(calls, [
      "get",
      "create",
      "update",
      "remove",
      "contracts",
      "invoices",
    ]);
  });
});
