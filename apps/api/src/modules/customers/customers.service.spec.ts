import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { describe, it } from "node:test";
import { CustomersService } from "./customers.service";

function createCustomersService() {
  const customers = [
    {
      id: "c1",
      tenantId: "tenant-a",
      name: "Cliente A",
      deletedAt: null,
      metadata: null,
      updatedAt: new Date(),
    },
    {
      id: "c2",
      tenantId: "tenant-a",
      name: "Cliente B",
      deletedAt: null,
      metadata: null,
      updatedAt: new Date(),
    },
  ];
  const prisma = {
    customer: {
      async findMany({ skip, take }: { skip: number; take: number }) {
        return customers.slice(skip, skip + take);
      },
      async count() {
        return customers.length;
      },
      async findFirst({ where }: { where: { id?: string; tenantId?: string } }) {
        return (
          customers.find(
            (customer) =>
              customer.id === where.id &&
              customer.tenantId === where.tenantId &&
              customer.deletedAt == null,
          ) ?? null
        );
      },
      async create({ data }: { data: Record<string, unknown> }) {
        return { id: "new-id", ...data };
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        return { id: where.id, ...data };
      },
      async delete({ where }: { where: { id: string } }) {
        return { id: where.id };
      },
    },
    contract: {
      async findMany() {
        return [{ id: "contract-1" }];
      },
    },
    invoice: {
      async findMany() {
        return [{ id: "invoice-1" }];
      },
    },
  };

  return {
    service: new CustomersService(prisma as never),
    customers,
  };
}

describe("CustomersService", () => {
  it("lists customers with pagination metadata", async () => {
    const { service } = createCustomersService();
    const result = await service.list("tenant-a", undefined, 1, 1);

    assert.equal(result.data.length, 1);
    assert.equal(result.total, 2);
    assert.equal(result.page, 1);
    assert.equal(result.limit, 1);
    assert.equal(result.totalPages, 2);
  });

  it("throws when customer is not found", async () => {
    const { service } = createCustomersService();
    await assert.rejects(
      () => service.get("tenant-a", "missing"),
      NotFoundException,
    );
  });

  it("returns nested contracts and invoices for existing customer", async () => {
    const { service } = createCustomersService();
    const contracts = await service.listContracts("tenant-a", "c1");
    const invoices = await service.listInvoices("tenant-a", "c1");

    assert.equal(contracts.length, 1);
    assert.equal(invoices.length, 1);
  });

  it("creates customers scoped to tenant", async () => {
    const { service } = createCustomersService();
    const created = await service.create("tenant-a", "member-id", {
      name: "Novo Cliente",
    });

    assert.equal(created.name, "Novo Cliente");
    assert.equal(created.tenantId, "tenant-a");
  });

  it("upserts external customers as created", async () => {
    const prisma = {
      customer: {
        async findFirst() {
          return null;
        },
        async create({ data }: { data: Record<string, unknown> }) {
          return { id: "created-id", ...data };
        },
      },
    };
    const service = new CustomersService(prisma as never);
    const result = await service.upsertFromExternalSource("tenant-a", "member-id", {
      externalId: "sgp-1",
      name: "Cliente SGP",
      document: "123",
    });

    assert.equal(result.operation, "created");
    assert.equal(result.customer.ispAccountCode, "sgp-1");
  });
});
