import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthController } from "./auth.controller";

describe("AuthController", () => {
  it("delegates login to AuthService", async () => {
    let received: unknown;
    const controller = new AuthController({
      login: async (dto: unknown) => {
        received = dto;
        return { accessToken: "token", user: { sub: "1" } };
      },
      profile: (user: unknown) => ({ user }),
    } as never);

    const response = await controller.login({
      email: "admin@example.com",
      password: "secret",
    });

    assert.deepEqual(received, {
      email: "admin@example.com",
      password: "secret",
    });
    assert.equal(response.accessToken, "token");
  });

  it("delegates /me to AuthService.profile", () => {
    const user = {
      sub: "user-id",
      email: "admin@example.com",
      name: "Admin",
      tenantId: "tenant-id",
      tenantName: "Tenant",
      memberId: "member-id",
      role: "Admin",
    };
    const controller = new AuthController({
      login: async () => ({}),
      profile: (current: unknown) => ({ user: current }),
    } as never);

    assert.deepEqual(controller.me(user), { user });
  });
});
