import assert from "node:assert/strict";
import { describe, it } from "node:test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import {
  assertMigrationsApplied,
  bootstrapProduction,
  normalizeEmail,
  normalizeSlug,
  readBootstrapConfig,
  validateBootstrapConfig,
} from "./lib/bootstrap-production.mjs";

const DATABASE_URL = process.env.DATABASE_URL;

function createMemoryClient() {
  const state = {
    tenants: new Map(),
    users: new Map(),
    roles: new Map(),
    permissions: new Map(),
    rolePermissions: new Set(),
    members: new Map(),
    inTransaction: false,
    shouldFailOnInsertUser: false,
  };

  const client = {
    state,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();

      if (normalized === "BEGIN") {
        state.inTransaction = true;
        return { rows: [] };
      }
      if (normalized === "COMMIT") {
        state.inTransaction = false;
        return { rows: [] };
      }
      if (normalized === "ROLLBACK") {
        state.inTransaction = false;
        return { rows: [] };
      }

      if (normalized.includes("information_schema.tables")) {
        return { rows: [{ exists: true }] };
      }
      if (normalized.includes('FROM "_prisma_migrations"')) {
        return { rows: [] };
      }
      if (normalized.startsWith('SELECT id FROM "Tenant" WHERE slug')) {
        const tenant = [...state.tenants.values()].find((item) => item.slug === params[0]);
        return { rows: tenant ? [{ id: tenant.id }] : [] };
      }
      if (normalized.startsWith('INSERT INTO "Tenant"')) {
        const id = `tenant-${state.tenants.size + 1}`;
        state.tenants.set(id, { id, name: params[0], slug: params[1] });
        return { rows: [{ id }] };
      }
      if (normalized.startsWith('INSERT INTO "Permission"')) {
        const code = params[0];
        if (!state.permissions.has(code)) {
          state.permissions.set(code, { id: `perm-${state.permissions.size + 1}`, code });
        }
        return { rows: [] };
      }
      if (normalized.startsWith('SELECT id, code FROM "Permission"')) {
        return {
          rows: params[0].map((code, index) => ({
            id: state.permissions.get(code)?.id ?? `perm-${index + 1}`,
            code,
          })),
        };
      }
      if (normalized.startsWith('SELECT id FROM "Role" WHERE "tenantId"')) {
        const role = [...state.roles.values()].find(
          (item) => item.tenantId === params[0] && item.name === "Administrador",
        );
        return { rows: role ? [{ id: role.id }] : [] };
      }
      if (normalized.startsWith('INSERT INTO "Role"')) {
        const id = `role-${state.roles.size + 1}`;
        state.roles.set(id, { id, tenantId: params[0], name: "Administrador" });
        return { rows: [{ id }] };
      }
      if (normalized.startsWith('INSERT INTO "RolePermission"')) {
        state.rolePermissions.add(`${params[0]}:${params[1]}`);
        return { rows: [] };
      }
      if (normalized.startsWith('SELECT id FROM "User" WHERE email')) {
        const user = [...state.users.values()].find((item) => item.email === params[0]);
        return { rows: user ? [{ id: user.id }] : [] };
      }
      if (normalized.startsWith('INSERT INTO "User"')) {
        if (state.shouldFailOnInsertUser) {
          throw new Error("simulated user insert failure");
        }
        const id = `user-${state.users.size + 1}`;
        state.users.set(id, { id, email: params[0], name: params[1], passwordHash: params[2] });
        return { rows: [{ id }] };
      }
      if (normalized.startsWith('INSERT INTO "TenantMember"')) {
        state.members.set(`${params[0]}:${params[1]}`, {
          tenantId: params[0],
          userId: params[1],
          roleId: params[2],
        });
        return { rows: [] };
      }

      throw new Error(`Unhandled query in memory client: ${normalized}`);
    },
  };

  return client;
}

const validConfig = {
  tenantName: "ISP Produção",
  tenantSlug: "isp-producao",
  adminName: "Administrador ISP",
  adminEmail: "admin.producao@example.org",
  adminPassword: "SenhaForte123",
};

describe("bootstrap-production config", () => {
  it("normalizes email and slug", () => {
    assert.equal(normalizeEmail(" Admin@Test.ORG "), "admin@test.org");
    assert.equal(normalizeSlug(" Fibra Plus ISP "), "fibra-plus-isp");
  });

  it("rejects weak passwords and missing variables", () => {
    assert.throws(
      () =>
        validateBootstrapConfig({
          ...validConfig,
          adminPassword: "curta",
        }),
      /12 caracteres/,
    );

    assert.throws(
      () =>
        validateBootstrapConfig({
          ...validConfig,
          adminEmail: "",
        }),
      /BOOTSTRAP_ADMIN_EMAIL/,
    );
  });

  it("rejects placeholder values", () => {
    assert.throws(
      () =>
        validateBootstrapConfig({
          ...validConfig,
          adminEmail: "admin@ispcrm.local",
        }),
      /placeholder/,
    );
  });
});

describe("bootstrap-production execution", () => {
  it("creates tenant, role, permissions and admin on empty database", async () => {
    const client = createMemoryClient();
    const result = await bootstrapProduction(client, validConfig, bcrypt.hash);

    assert.ok(result.tenantId);
    assert.equal(result.userCreated, true);
    assert.equal(client.state.users.size, 1);
    assert.equal(client.state.members.size, 1);
    assert.ok(client.state.rolePermissions.size >= 7);
  });

  it("is idempotent on second execution", async () => {
    const client = createMemoryClient();
    await bootstrapProduction(client, validConfig, bcrypt.hash);
    const second = await bootstrapProduction(client, validConfig, bcrypt.hash);

    assert.equal(second.userCreated, false);
    assert.equal(client.state.users.size, 1);
    assert.equal(client.state.tenants.size, 1);
  });

  it("reuses existing tenant and user without duplicating records", async () => {
    const client = createMemoryClient();
    const tenantId = "tenant-existing";
    client.state.tenants.set(tenantId, {
      id: tenantId,
      name: validConfig.tenantName,
      slug: validConfig.tenantSlug,
    });
    client.state.users.set("user-existing", {
      id: "user-existing",
      email: validConfig.adminEmail,
      name: validConfig.adminName,
      passwordHash: "hash",
    });

    const result = await bootstrapProduction(client, validConfig, bcrypt.hash);
    assert.equal(result.userCreated, false);
    assert.equal(client.state.users.size, 1);
    assert.equal(client.state.tenants.size, 1);
  });

  it("rolls back when a step fails inside the transaction", async () => {
    const client = createMemoryClient();
    client.state.shouldFailOnInsertUser = true;

    await assert.rejects(() => bootstrapProduction(client, validConfig, bcrypt.hash), /simulated/);
    assert.equal(client.state.users.size, 0);
    assert.equal(client.state.members.size, 0);
  });
});

describe("bootstrap-production integration", () => {
  it("runs against real database when DATABASE_URL is configured", async (t) => {
    if (!DATABASE_URL) {
      t.skip("DATABASE_URL não configurada");
      return;
    }

    const suffix = Date.now();
    const config = {
      tenantName: `Bootstrap Test ${suffix}`,
      tenantSlug: `bootstrap-test-${suffix}`,
      adminName: "Bootstrap Admin",
      adminEmail: `bootstrap.${suffix}@example.org`,
      adminPassword: "BootstrapTest123",
    };

    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    try {
      try {
        await assertMigrationsApplied(client);
      } catch (error) {
        t.skip(error instanceof Error ? error.message : String(error));
        return;
      }

      const first = await bootstrapProduction(client, config, bcrypt.hash);
      const second = await bootstrapProduction(client, config, bcrypt.hash);
      assert.equal(first.userCreated, true);
      assert.equal(second.userCreated, false);
    } finally {
      await client.end();
    }
  });
});

describe("readBootstrapConfig", () => {
  it("reads values from environment", () => {
    const config = readBootstrapConfig({
      BOOTSTRAP_TENANT_NAME: "Tenant X",
      BOOTSTRAP_TENANT_SLUG: "Tenant-X",
      BOOTSTRAP_ADMIN_NAME: "Admin",
      BOOTSTRAP_ADMIN_EMAIL: "Admin@Example.ORG",
      BOOTSTRAP_ADMIN_PASSWORD: "SenhaForte123",
    });

    assert.equal(config.tenantSlug, "tenant-x");
    assert.equal(config.adminEmail, "admin@example.org");
  });
});
