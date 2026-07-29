import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { hashSync } from "bcryptjs";
import { describe, it } from "node:test";
import { AuthService } from "./auth.service";

const password = "secret123";
const passwordHash = hashSync(password, 4);

function createAuthService(overrides: {
  user?: Record<string, unknown> | null;
  signAsync?: (payload: unknown) => Promise<string>;
} = {}) {
  const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const prisma = {
    user: {
      async findUnique() {
        return overrides.user ?? null;
      },
      async update(input: { where: { id: string }; data: Record<string, unknown> }) {
        updates.push(input);
        return input;
      },
    },
  };
  const jwt = {
    async signAsync(payload: unknown) {
      return overrides.signAsync ? overrides.signAsync(payload) : "signed-token";
    },
  };
  const config = {
    get(_key: string, fallback?: string) {
      return fallback;
    },
  };

  return {
    service: new AuthService(prisma as never, jwt as never, config as never),
    updates,
  };
}

const activeUser = {
  id: "user-id",
  email: "admin@example.com",
  name: "Admin",
  status: "ACTIVE",
  passwordHash,
  memberships: [
    {
      id: "member-id",
      tenantId: "tenant-id",
      tenant: { name: "Tenant A" },
      role: {
        name: "Admin",
        permissions: [{ permission: { code: "dashboard.read" } }],
      },
    },
  ],
};

describe("AuthService", () => {
  it("returns access token and user payload on valid login", async () => {
    const { service, updates } = createAuthService({ user: activeUser });
    const result = await service.login({
      email: "Admin@Example.com",
      password,
    });

    assert.equal(result.accessToken, "signed-token");
    assert.equal(result.user.email, "admin@example.com");
    assert.equal(result.user.tenantId, "tenant-id");
    assert.deepEqual(result.user.permissions, ["dashboard.read"]);
    assert.equal(updates.length, 1);
  });

  it("rejects invalid credentials for missing user", async () => {
    const { service } = createAuthService({ user: null });
    await assert.rejects(
      () => service.login({ email: "missing@example.com", password }),
      UnauthorizedException,
    );
  });

  it("rejects invalid password", async () => {
    const { service } = createAuthService({ user: activeUser });
    await assert.rejects(
      () => service.login({ email: activeUser.email, password: "wrong" }),
      UnauthorizedException,
    );
  });

  it("rejects inactive users", async () => {
    const { service } = createAuthService({
      user: { ...activeUser, status: "DISABLED" },
    });
    await assert.rejects(
      () => service.login({ email: activeUser.email, password }),
      UnauthorizedException,
    );
  });

  it("rejects users without active membership", async () => {
    const { service } = createAuthService({
      user: { ...activeUser, memberships: [] },
    });
    await assert.rejects(
      () => service.login({ email: activeUser.email, password }),
      UnauthorizedException,
    );
  });

  it("returns profile wrapper", () => {
    const { service } = createAuthService();
    const user = {
      sub: "user-id",
      email: "admin@example.com",
      name: "Admin",
      tenantId: "tenant-id",
      tenantName: "Tenant A",
      memberId: "member-id",
      role: "Admin",
    };
    assert.deepEqual(service.profile(user), { user });
  });
});
