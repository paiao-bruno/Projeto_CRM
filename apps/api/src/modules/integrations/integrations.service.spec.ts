import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntegrationSyncStatus } from "@prisma/client";
import { IntegrationsService } from "./integrations.service";

const user = {
  sub: "user-id",
  email: "admin@example.com",
  name: "Admin",
  tenantId: "tenant-id",
  tenantName: "Tenant",
  memberId: "member-id",
  role: "Admin",
};

const credentials = {
  apiUrl: "https://webmais.sgp.net.br",
  app: "siac",
  token: "secret-token",
};

function createSgpCredentialsMock() {
  return {
    resolveActiveCredentials: async () => credentials,
    resolveCredentialsById: async () => credentials,
    getSyncState: async () => ({
      lastSuccessfulSyncAt: "2026-07-17T10:00:00.000Z",
    }),
    updateSyncState: async () => undefined,
    list: async () => [],
    get: async () => ({}),
    create: async () => ({}),
    update: async () => ({}),
    remove: async () => ({ deleted: true }),
    markConnectionResult: async () => undefined,
  };
}

function createPrismaMock() {
  return {
    customer: {
      rows: [] as Array<Record<string, unknown>>,
      async findFirst({
        where,
      }: {
        where: {
          tenantId?: string;
          deletedAt?: null;
          ispAccountCode?: string;
          OR?: Array<{ ispAccountCode?: string; document?: string }>;
        };
      }) {
        return (
          this.rows.find((row) => {
            if (row.deletedAt != null) return false;

            if (where.ispAccountCode && row.ispAccountCode === where.ispAccountCode) {
              return true;
            }

            if (where.OR?.length) {
              return where.OR.some((condition) => {
                if (condition.ispAccountCode && row.ispAccountCode === condition.ispAccountCode) {
                  return true;
                }
                if (condition.document && row.document === condition.document) {
                  return true;
                }
                return false;
              });
            }

            return where.deletedAt === null;
          }) ?? null
        );
      },
      async findMany() {
        return this.rows.filter((row) => row.deletedAt == null);
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = this.rows.find((item) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
    },
    integrationSyncRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "run-id",
        ...data,
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => data,
      findFirst: async () => ({
        finishedAt: new Date("2026-07-17T10:00:00.000Z"),
      }),
    },
    integrationSyncLog: {
      rows: [] as unknown[],
      async create({ data }: { data: unknown }) {
        this.rows.push(data);
        return data;
      },
    },
    contract: {
      rows: new Map<string, Record<string, unknown>>(),
      async findUnique({ where }: { where: { tenantId_externalId: { externalId: string } } }) {
        return this.rows.get(where.tenantId_externalId.externalId) ?? null;
      },
      async findMany() {
        return [];
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `contract-${data.externalId}`, ...data };
        this.rows.set(String(data.externalId), row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        return { id: where.id, ...data };
      },
    },
    invoice: {
      rows: new Map<string, Record<string, unknown>>(),
      async findUnique({ where }: { where: { tenantId_externalId: { externalId: string } } }) {
        return this.rows.get(where.tenantId_externalId.externalId) ?? null;
      },
      async findMany() {
        return [];
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `invoice-${data.externalId}`, ...data };
        this.rows.set(String(data.externalId), row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        return { id: where.id, ...data };
      },
    },
  };
}

describe("IntegrationsService", () => {
  it("discovers customers without persisting data", async () => {
    let upserts = 0;
    const service = new IntegrationsService(
      {
        discoverCustomers: async (_creds: typeof credentials, _payload: Record<string, unknown>) => ({
          body: {
            clientes: [{ id: 1, nome: "Cliente", cpfcnpj: "00000000000" }],
          },
        }),
      } as never,
      createSgpCredentialsMock() as never,
      {
        upsertFromExternalSource: async () => {
          upserts += 1;
        },
      } as never,
      createPrismaMock() as never,
    );

    const preview = await service.discoverSgpCustomers(user, {});

    assert.equal(preview.processed, 1);
    assert.equal(upserts, 0);
  });

  it("syncs paginated customers and persists customer, contract and invoice records", async () => {
    const prisma = createPrismaMock();
    const calls: unknown[] = [];
    const service = new IntegrationsService(
      {
        discoverCustomers: async (_creds: typeof credentials, payload: Record<string, unknown>) => {
          calls.push(payload);
          if (calls.length === 1) {
            return {
              body: {
                clientes: [{ id: "1", nome: "Cliente A", cpfcnpj: "111", data_alteracao: "17/07/2026 11:00:00" }],
                contratos: [{ id: "c1", cliente_id: "1", status: "ATIVO", data_alteracao: "17/07/2026 11:00:00" }],
                titulos: [{ id: "t1", cliente_id: "1", valor: "10,00", status: "ABERTO", data_alteracao: "17/07/2026 11:00:00" }],
                offset: 0,
                limit: 1,
                parcial: 1,
                total: 2,
              },
            };
          }
          return {
            body: {
              clientes: [{ id: "2", nome: "Cliente B", cpfcnpj: "222", data_alteracao: "17/07/2026 11:00:00" }],
              offset: 1,
              limit: 1,
              parcial: 1,
              total: 2,
            },
          };
        },
      } as never,
      createSgpCredentialsMock() as never,
      {
        async upsertFromExternalSource(
          _tenantId: string,
          _memberId: string,
          input: { externalId?: string },
        ) {
          return {
            operation: "created" as const,
            customer: { id: `customer-${input.externalId}` },
          };
        },
      } as never,
      prisma as never,
    );

    const result = await (
      service as unknown as {
        processSgpCustomers: (
          userArg: typeof user,
          request: { pagination: { offset: number; limit: number } },
          runId: string,
        ) => Promise<{
          processed: number;
          created: number;
          unchanged: number;
          contractsCreated: number;
          invoicesCreated: number;
        }>;
      }
    ).processSgpCustomers(user, { pagination: { offset: 0, limit: 1 } }, "run-id");

    assert.equal(result.processed, 2);
    assert.equal(result.created, 2);
    assert.equal(result.unchanged, 0);
    assert.equal(result.contractsCreated, 1);
    assert.equal(result.invoicesCreated, 1);
    assert.equal(calls.length, 2);
    assert.ok((calls[0] as Record<string, unknown>).alterado_desde);
    assert.ok(prisma.integrationSyncLog.rows.length >= 4);
  });

  it("skips unchanged records during incremental sync", async () => {
    const prisma = createPrismaMock();
    prisma.customer.rows.push({
      id: "customer-1",
      tenantId: user.tenantId,
      ispAccountCode: "1",
      document: "111",
      deletedAt: null,
      metadata: { source: "SGP" },
    });

    const service = new IntegrationsService(
      {
        discoverCustomers: async () => ({
          body: {
            clientes: [
              {
                id: "1",
                nome: "Cliente A",
                cpfcnpj: "111",
                data_alteracao: "17/07/2026 09:00:00",
              },
              {
                id: "2",
                nome: "Cliente B",
                cpfcnpj: "222",
                data_alteracao: "17/07/2026 11:00:00",
              },
            ],
          },
        }),
      } as never,
      createSgpCredentialsMock() as never,
      {
        async upsertFromExternalSource(
          _tenantId: string,
          _memberId: string,
          input: { externalId?: string },
        ) {
          return {
            operation: "created" as const,
            customer: { id: `customer-${input.externalId}` },
          };
        },
      } as never,
      prisma as never,
    );

    const result = await (
      service as unknown as {
        processSgpCustomers: (
          userArg: typeof user,
          request: { pagination: { offset: number; limit: number } },
          runId: string,
        ) => Promise<{
          processed: number;
          created: number;
          unchanged: number;
        }>;
      }
    ).processSgpCustomers(user, { pagination: { offset: 0, limit: 10 } }, "run-id");

    assert.equal(result.processed, 2);
    assert.equal(result.created, 1);
    assert.equal(result.unchanged, 1);
  });

  it("soft deletes customers missing from a full sync", async () => {
    const prisma = createPrismaMock();
    prisma.customer.rows.push({
      id: "customer-1",
      tenantId: user.tenantId,
      ispAccountCode: "999",
      deletedAt: null,
      metadata: { source: "SGP" },
    });

    const service = new IntegrationsService(
      {
        discoverCustomers: async () => ({
          body: {
            clientes: [{ id: "1", nome: "Cliente A", cpfcnpj: "111" }],
          },
        }),
      } as never,
      createSgpCredentialsMock() as never,
      {
        async upsertFromExternalSource(
          _tenantId: string,
          _memberId: string,
          input: { externalId?: string },
        ) {
          return {
            operation: "created" as const,
            customer: { id: `customer-${input.externalId}` },
          };
        },
      } as never,
      prisma as never,
    );

    const result = await (
      service as unknown as {
        processSgpCustomers: (
          userArg: typeof user,
          request: { full: boolean },
          runId: string,
        ) => Promise<{ customersDeleted: number }>;
      }
    ).processSgpCustomers(user, { full: true }, "run-id");

    assert.equal(result.customersDeleted, 1);
    assert.ok(prisma.customer.rows[0].deletedAt);
  });

  it("records skipped runs when another sync is running", async () => {
    const prisma = createPrismaMock();
    const service = new IntegrationsService(
      {} as never,
      createSgpCredentialsMock() as never,
      {} as never,
      prisma as never,
    );
    (service as unknown as { runningCustomerSyncs: Set<string> }).runningCustomerSyncs.add(user.tenantId);

    const result = await service.syncSgpCustomers(user, {});

    assert.equal(result.status, "already_running");
    assert.equal((result as { runId: string }).runId, "run-id");
    assert.equal((await prisma.integrationSyncRun.update({ data: { status: IntegrationSyncStatus.SKIPPED } })).status, IntegrationSyncStatus.SKIPPED);
  });
});
