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

  it("rejects insecure CORS configuration in production", () => {
    const config = {
      get: (key: string) => {
        const values: Record<string, string> = {
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://user:pass@db:5432/app",
          JWT_ACCESS_SECRET: "x".repeat(32),
          ENCRYPTION_KEY: "y".repeat(32),
          APP_URL: "http://insecure.local",
          CORS_ORIGINS: "*",
        };
        return values[key];
      },
    } as ConfigService;

    assert.throws(() => assertProductionEnvironment(config), /CORS_ORIGINS/);
  });

  it("accepts valid production configuration", () => {
    const config = {
      get: (key: string) => {
        const values: Record<string, string> = {
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://user:pass@db:5432/app",
          JWT_ACCESS_SECRET: "x".repeat(32),
          ENCRYPTION_KEY: "y".repeat(32),
          APP_URL: "https://crm.example.com",
          CORS_ORIGINS: "https://crm.example.com",
        };
        return values[key];
      },
    } as ConfigService;

    assert.doesNotThrow(() => assertProductionEnvironment(config));
  });
});
