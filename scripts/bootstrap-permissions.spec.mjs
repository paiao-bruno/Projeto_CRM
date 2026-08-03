import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SALES_FUNNEL_PERMISSIONS,
  ensureSalesFunnelPermissions,
} from "./lib/bootstrap-production.mjs";

describe("ensureSalesFunnelPermissions", () => {
  it("declara permissões do funil", () => {
    assert.deepEqual(SALES_FUNNEL_PERMISSIONS, [
      "sales_funnel.read",
      "sales_funnel.manage",
    ]);
  });

  it("é idempotente em memória simulada", async () => {
    const permissions = new Map();
    const rolePermissions = new Set();

    const client = {
      async query(sql, params = []) {
        if (sql.includes('INSERT INTO "Permission"')) {
          const code = params[0];
          if (!permissions.has(code)) permissions.set(code, `perm-${code}`);
          return { rows: [] };
        }
        if (sql.includes('SELECT id, code FROM "Permission"')) {
          return {
            rows: params[0].map((code) => ({ id: permissions.get(code), code })),
          };
        }
        if (sql.includes('INSERT INTO "RolePermission"')) {
          rolePermissions.add(`${params[0]}:${params[1]}`);
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    await ensureSalesFunnelPermissions(client, "role-1");
    await ensureSalesFunnelPermissions(client, "role-1");
    assert.equal(rolePermissions.size, 2);
  });
});
