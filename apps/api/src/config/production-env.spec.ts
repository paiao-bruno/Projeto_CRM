import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigService } from "@nestjs/config";
import {
  assertProductionEnvironment,
  resolveRequiredSecret,
} from "./production-env";

describe("production-env", () => {
  it("allows dev fallbacks outside production", () => {
    const config = {
      get: (key: string) => (key === "NODE_ENV" ? "development" : undefined),
    } as ConfigService;

    assert.equal(
      resolveRequiredSecret(config, "JWT_ACCESS_SECRET", "dev-access-secret"),
      "dev-access-secret",
    );
  });

  it("requires secrets in production", () => {
    const config = {
      get: (key: string) => (key === "NODE_ENV" ? "production" : undefined),
    } as ConfigService;

    assert.throws(() => resolveRequiredSecret(config, "JWT_ACCESS_SECRET", "dev-access-secret"));
    assert.throws(() => assertProductionEnvironment(config));
  });
});
