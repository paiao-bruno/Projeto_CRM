import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeNextRunAt,
  isAutoSyncDue,
  readAutoSyncConfig,
  readEnvAutoSyncDefaults,
} from "./sgp-auto-sync.config";

describe("sgp-auto-sync.config", () => {
  it("reads env defaults", () => {
    const defaults = readEnvAutoSyncDefaults({
      SGP_AUTO_SYNC_ENABLED: "true",
      SGP_AUTO_SYNC_CRON: "0 */6 * * *",
      SGP_AUTO_SYNC_INTERVAL_MINUTES: "120",
      SGP_AUTO_SYNC_RETRY_ATTEMPTS: "2",
      SGP_AUTO_SYNC_RETRY_DELAY_MS: "5000",
      SGP_AUTO_SYNC_TIMEOUT_MS: "600000",
    });

    assert.equal(defaults.enabled, true);
    assert.equal(defaults.cron, "0 */6 * * *");
    assert.equal(defaults.intervalMinutes, 120);
    assert.equal(defaults.retryAttempts, 2);
  });

  it("merges tenant auto sync config with env defaults", () => {
    const config = readAutoSyncConfig(
      {
        autoSync: {
          enabled: false,
          intervalMinutes: 30,
        },
      },
      readEnvAutoSyncDefaults({
        SGP_AUTO_SYNC_ENABLED: "true",
        SGP_AUTO_SYNC_INTERVAL_MINUTES: "360",
      }),
    );

    assert.equal(config.enabled, false);
    assert.equal(config.intervalMinutes, 30);
  });

  it("detects due sync by interval", () => {
    const config = readAutoSyncConfig(null, readEnvAutoSyncDefaults({ SGP_AUTO_SYNC_INTERVAL_MINUTES: "60" }));
    const now = new Date("2026-07-17T12:00:00.000Z");
    const lastRunAt = new Date("2026-07-17T10:30:00.000Z");

    assert.equal(isAutoSyncDue(config, lastRunAt, now), true);
    assert.equal(isAutoSyncDue(config, new Date("2026-07-17T11:30:00.000Z"), now), false);
  });

  it("computes next run timestamp", () => {
    const config = readAutoSyncConfig(null, readEnvAutoSyncDefaults({ SGP_AUTO_SYNC_INTERVAL_MINUTES: "30" }));
    const from = new Date("2026-07-17T12:00:00.000Z");
    assert.equal(computeNextRunAt(config, from), "2026-07-17T12:30:00.000Z");
  });
});
