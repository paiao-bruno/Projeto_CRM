import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { SchedulerRegistry } from "@nestjs/schedule";
import { SgpAutoSyncScheduler } from "./sgp-auto-sync.scheduler";

describe("SgpAutoSyncScheduler", () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    process.env.SGP_AUTO_SYNC_ENABLED = "true";
    process.env.SGP_AUTO_SYNC_INTERVAL_MINUTES = "30";
    process.env.SGP_AUTO_SYNC_CRON = "0 */6 * * *";
  });

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  it("registers cron and interval jobs when enabled", () => {
    const registry = new SchedulerRegistry();
    let cronCalls = 0;
    const scheduler = new SgpAutoSyncScheduler(
      registry,
      {
        runDueSyncs: async () => {
          cronCalls += 1;
          return [];
        },
      } as never,
    );

    scheduler.onModuleInit();

    assert.ok(registry.doesExist("cron", "sgp-auto-sync-cron"));
    assert.ok(registry.doesExist("interval", "sgp-auto-sync-interval"));
    scheduler.onModuleDestroy();
    assert.equal(registry.doesExist("cron", "sgp-auto-sync-cron"), false);
  });

  it("does not register jobs when disabled via env", () => {
    process.env.SGP_AUTO_SYNC_ENABLED = "false";
    const registry = new SchedulerRegistry();
    const scheduler = new SgpAutoSyncScheduler(registry, {
      runDueSyncs: async () => [],
    } as never);

    scheduler.onModuleInit();

    assert.equal(registry.doesExist("cron", "sgp-auto-sync-cron"), false);
    assert.equal(registry.doesExist("interval", "sgp-auto-sync-interval"), false);
  });
});
