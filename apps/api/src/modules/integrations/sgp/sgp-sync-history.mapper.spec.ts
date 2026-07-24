import assert from "node:assert/strict";
import { IntegrationSyncStatus } from "@prisma/client";
import { describe, it } from "node:test";
import { mapSgpSyncHistoryEntry } from "./sgp-sync-history.mapper";

describe("sgp-sync-history.mapper", () => {
  it("maps sync run with tenant, user and entity counters", () => {
    const entry = mapSgpSyncHistoryEntry({
      id: "run-1",
      tenantId: "tenant-1",
      integrationId: "integration-1",
      triggeredById: "member-1",
      operation: "sgp.sync-customers",
      status: IntegrationSyncStatus.COMPLETED,
      syncMode: "incremental",
      trigger: "manual",
      startedAt: new Date("2026-07-17T10:00:00.000Z"),
      finishedAt: new Date("2026-07-17T10:05:00.000Z"),
      durationMs: 300_000,
      processed: 10,
      created: 12,
      updated: 4,
      ignored: 3,
      errorsCount: 1,
      customersProcessed: 10,
      customersCreated: 2,
      customersUpdated: 1,
      customersDeleted: 0,
      customersIgnored: 1,
      contractsProcessed: 8,
      contractsCreated: 5,
      contractsUpdated: 2,
      contractsDeleted: 1,
      contractsIgnored: 0,
      invoicesProcessed: 6,
      invoicesCreated: 5,
      invoicesUpdated: 1,
      invoicesDeleted: 0,
      invoicesIgnored: 0,
      errors: [{ index: 0, message: "Falha parcial" }],
      stackTrace: null,
      cursor: null,
      errorMessage: null,
      metadata: null,
      tenant: {
        id: "tenant-1",
        name: "Empresa Demo",
      },
      triggeredBy: {
        id: "member-1",
        displayName: "Admin",
        user: {
          name: "Administrador",
          email: "admin@example.com",
        },
      },
    });

    assert.equal(entry.tenant.name, "Empresa Demo");
    assert.equal(entry.triggeredBy?.email, "admin@example.com");
    assert.equal(entry.customers.created, 2);
    assert.equal(entry.contracts.deleted, 1);
    assert.equal(entry.invoices.created, 5);
    assert.equal(entry.deleted, 1);
    assert.equal(entry.errors[0]?.message, "Falha parcial");
    assert.equal(entry.durationMs, 300_000);
  });

  it("falls back to metadata counters for legacy runs", () => {
    const entry = mapSgpSyncHistoryEntry({
      id: "run-legacy",
      tenantId: "tenant-1",
      integrationId: null,
      triggeredById: null,
      operation: "sgp.sync-customers",
      status: IntegrationSyncStatus.PARTIAL,
      syncMode: null,
      trigger: null,
      startedAt: new Date("2026-07-17T11:00:00.000Z"),
      finishedAt: new Date("2026-07-17T11:01:00.000Z"),
      durationMs: 60_000,
      processed: 5,
      created: 3,
      updated: 1,
      ignored: 2,
      errorsCount: 1,
      customersProcessed: 0,
      customersCreated: 0,
      customersUpdated: 0,
      customersDeleted: 0,
      customersIgnored: 0,
      contractsProcessed: 0,
      contractsCreated: 0,
      contractsUpdated: 0,
      contractsDeleted: 0,
      contractsIgnored: 0,
      invoicesProcessed: 0,
      invoicesCreated: 0,
      invoicesUpdated: 0,
      invoicesDeleted: 0,
      invoicesIgnored: 0,
      errors: null,
      stackTrace: "Error: boom",
      cursor: null,
      errorMessage: "boom",
      metadata: {
        syncMode: "full",
        trigger: "manual",
        customers: { created: 1, updated: 1, unchanged: 1, deleted: 2 },
        contracts: { created: 1, updated: 0, unchanged: 0, deleted: 0 },
        invoices: { created: 1, updated: 0, unchanged: 1, deleted: 0 },
        errors: [{ index: 2, message: "Erro legado" }],
      },
      tenant: {
        id: "tenant-1",
        name: "Empresa Legada",
      },
      triggeredBy: null,
    });

    assert.equal(entry.syncMode, "full");
    assert.equal(entry.trigger, "manual");
    assert.equal(entry.customers.deleted, 2);
    assert.equal(entry.errors[0]?.message, "Erro legado");
    assert.equal(entry.stackTrace, "Error: boom");
  });
});
