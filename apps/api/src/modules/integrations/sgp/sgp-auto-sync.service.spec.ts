import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SgpAutoSyncService } from "./sgp-auto-sync.service";

describe("SgpAutoSyncService", () => {
  it("skips disabled integrations and not-due tenants on cron trigger", async () => {
    const service = new SgpAutoSyncService(
      {
        recoverStaleSyncRuns: async () => 0,
        runAutomatedSgpSync: async () => {
          throw new Error("should not run");
        },
      } as never,
      {
        listAutoSyncCandidates: async () => [
          {
            id: "integration-1",
            tenantId: "tenant-1",
            config: { autoSync: { enabled: false } },
          },
          {
            id: "integration-2",
            tenantId: "tenant-2",
            config: {
              autoSync: {
                enabled: true,
                intervalMinutes: 60,
                lastRunAt: new Date().toISOString(),
              },
            },
          },
        ],
      } as never,
      { get: () => 900_000 } as never,
    );

    const results = await service.runDueSyncs("cron");
    assert.deepEqual(results, []);
  });

  it("runs manual sync even when not due", async () => {
    let called = false;
    const service = new SgpAutoSyncService(
      {
        recoverStaleSyncRuns: async () => 0,
        runAutomatedSgpSync: async () => {
          called = true;
          return { status: "completed", runId: "run-1" };
        },
      } as never,
      {
        listAutoSyncCandidates: async () => [
          {
            id: "integration-1",
            tenantId: "tenant-1",
            config: {
              autoSync: {
                enabled: true,
                intervalMinutes: 60,
                lastRunAt: new Date().toISOString(),
              },
            },
          },
        ],
      } as never,
      { get: () => 900_000 } as never,
    );

    const results = await service.runDueSyncs("manual");

    assert.equal(called, true);
    assert.deepEqual(results, [
      { tenantId: "tenant-1", status: "completed", runId: "run-1" },
    ]);
  });

  it("returns already_running when tenant lock is active", async () => {
    const service = new SgpAutoSyncService(
      {
        recoverStaleSyncRuns: async () => 0,
        runAutomatedSgpSync: async () => ({ status: "completed", runId: "run-1" }),
      } as never,
      {
        listAutoSyncCandidates: async () => [
          {
            id: "integration-1",
            tenantId: "tenant-1",
            config: { autoSync: { enabled: true, intervalMinutes: 1 } },
          },
        ],
      } as never,
      { get: () => 900_000 } as never,
    );

    (service as unknown as { runningTenants: Set<string> }).runningTenants.add("tenant-1");
    const results = await service.runDueSyncs("manual");

    assert.deepEqual(results, [{ tenantId: "tenant-1", status: "already_running" }]);
  });
});
