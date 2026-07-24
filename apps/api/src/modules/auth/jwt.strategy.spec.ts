import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JwtStrategy } from "./jwt.strategy";

describe("JwtStrategy", () => {
  it("returns auth payload unchanged from validate()", () => {
    const strategy = new JwtStrategy({
      get: (_key: string, fallback?: string) => fallback,
    } as never);
    const payload = {
      sub: "user-id",
      email: "admin@example.com",
      name: "Admin",
      tenantId: "tenant-id",
      tenantName: "Tenant",
      memberId: "member-id",
      role: "Admin",
      permissions: ["dashboard.read"],
    };

    assert.deepEqual(strategy.validate(payload), payload);
  });
});
