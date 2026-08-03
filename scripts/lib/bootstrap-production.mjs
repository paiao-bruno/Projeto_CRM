export const PRODUCTION_PERMISSIONS = [
  "dashboard.read",
  "chat.read",
  "chat.reply",
  "chat.transfer",
  "ai_agents.manage",
  "crm.manage",
  "customers.manage",
  "sales_funnel.read",
  "sales_funnel.manage",
];

export const SALES_FUNNEL_PERMISSIONS = ["sales_funnel.read", "sales_funnel.manage"];

export const PLACEHOLDER_VALUES = new Set([
  "",
  "change-me",
  "change-me-access-secret-min-32-chars",
  "change-me-use-at-least-32-characters-here",
  "admin123",
  "admin@ispcrm.local",
  "admin",
  "password",
  "12345678",
  "bootstrap",
  "example.com",
]);

export function normalizeEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

export function normalizeSlug(slug) {
  return String(slug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function readBootstrapConfig(env = process.env) {
  return {
    tenantName: env.BOOTSTRAP_TENANT_NAME?.trim(),
    tenantSlug: normalizeSlug(env.BOOTSTRAP_TENANT_SLUG),
    adminName: env.BOOTSTRAP_ADMIN_NAME?.trim(),
    adminEmail: normalizeEmail(env.BOOTSTRAP_ADMIN_EMAIL),
    adminPassword: env.BOOTSTRAP_ADMIN_PASSWORD ?? "",
  };
}

export function validateBootstrapConfig(config) {
  const missing = [];
  if (!config.tenantName) missing.push("BOOTSTRAP_TENANT_NAME");
  if (!config.tenantSlug) missing.push("BOOTSTRAP_TENANT_SLUG");
  if (!config.adminName) missing.push("BOOTSTRAP_ADMIN_NAME");
  if (!config.adminEmail) missing.push("BOOTSTRAP_ADMIN_EMAIL");
  if (!config.adminPassword) missing.push("BOOTSTRAP_ADMIN_PASSWORD");

  if (missing.length > 0) {
    throw new Error(`Variáveis obrigatórias ausentes: ${missing.join(", ")}`);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.adminEmail)) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL inválido.");
  }

  if (config.adminPassword.length < 12) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD deve ter ao menos 12 caracteres.");
  }

  if (!/[A-Z]/.test(config.adminPassword) || !/[a-z]/.test(config.adminPassword) || !/[0-9]/.test(config.adminPassword)) {
    throw new Error(
      "BOOTSTRAP_ADMIN_PASSWORD deve conter letras maiúsculas, minúsculas e números.",
    );
  }

  for (const value of [
    config.tenantName,
    config.tenantSlug,
    config.adminName,
    config.adminEmail,
    config.adminPassword,
  ]) {
    if (PLACEHOLDER_VALUES.has(String(value).trim().toLowerCase())) {
      throw new Error("Valores placeholder ou fracos não são permitidos no bootstrap de produção.");
    }
  }
}

export async function assertMigrationsApplied(client) {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
    ) AS exists
  `);

  if (!result.rows[0]?.exists) {
    throw new Error("Migrations pendentes: tabela _prisma_migrations não encontrada.");
  }

  const failed = await client.query(`
    SELECT migration_name
    FROM "_prisma_migrations"
    WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
    LIMIT 1
  `);

  if (failed.rows.length > 0) {
    throw new Error(`Migrations pendentes ou com falha: ${failed.rows[0].migration_name}`);
  }
}

export async function bootstrapProduction(client, config, hashPassword) {
  validateBootstrapConfig(config);
  await assertMigrationsApplied(client);

  await client.query("BEGIN");

  try {
    const existingTenant = await client.query(`SELECT id FROM "Tenant" WHERE slug = $1 LIMIT 1`, [
      config.tenantSlug,
    ]);

    let tenantId = existingTenant.rows[0]?.id;
    if (!tenantId) {
      const tenant = await client.query(
        `INSERT INTO "Tenant" (id, name, slug, status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', NOW(), NOW())
         RETURNING id`,
        [config.tenantName, config.tenantSlug],
      );
      tenantId = tenant.rows[0].id;
    }

    for (const code of PRODUCTION_PERMISSIONS) {
      await client.query(
        `INSERT INTO "Permission" (id, code, description, "createdAt")
         VALUES (gen_random_uuid(), $1, $1, NOW())
         ON CONFLICT (code) DO NOTHING`,
        [code],
      );
    }

    const permissions = await client.query(`SELECT id, code FROM "Permission" WHERE code = ANY($1)`, [
      PRODUCTION_PERMISSIONS,
    ]);

    let roleId;
    const existingRole = await client.query(
      `SELECT id FROM "Role" WHERE "tenantId" = $1 AND name = 'Administrador' LIMIT 1`,
      [tenantId],
    );
    roleId = existingRole.rows[0]?.id;

    if (!roleId) {
      const role = await client.query(
        `INSERT INTO "Role" (id, "tenantId", name, description, scope, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, 'Administrador', 'Acesso administrativo ao CRM', 'TENANT', NOW(), NOW())
         RETURNING id`,
        [tenantId],
      );
      roleId = role.rows[0].id;
    }

    for (const permission of permissions.rows) {
      await client.query(
        `INSERT INTO "RolePermission" ("roleId", "permissionId", "createdAt")
         VALUES ($1, $2, NOW())
         ON CONFLICT DO NOTHING`,
        [roleId, permission.id],
      );
    }

    const existingUser = await client.query(`SELECT id FROM "User" WHERE email = $1 LIMIT 1`, [
      config.adminEmail,
    ]);

    let userId = existingUser.rows[0]?.id;
    let userCreated = false;

    if (!userId) {
      const passwordHash = await hashPassword(config.adminPassword, 10);
      const user = await client.query(
        `INSERT INTO "User" (id, email, name, "passwordHash", status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE', NOW(), NOW())
         RETURNING id`,
        [config.adminEmail, config.adminName, passwordHash],
      );
      userId = user.rows[0].id;
      userCreated = true;
    }

    await client.query(
      `INSERT INTO "TenantMember" (id, "tenantId", "userId", "roleId", status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE', NOW(), NOW())
       ON CONFLICT ("tenantId", "userId") DO UPDATE
       SET "roleId" = EXCLUDED."roleId", status = 'ACTIVE', "updatedAt" = NOW()`,
      [tenantId, userId, roleId],
    );

    await client.query("COMMIT");

    return {
      tenantId,
      tenantSlug: config.tenantSlug,
      adminEmail: config.adminEmail,
      userCreated,
      roleId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function ensureSalesFunnelPermissions(client, roleId) {
  for (const code of SALES_FUNNEL_PERMISSIONS) {
    await client.query(
      `INSERT INTO "Permission" (id, code, description, "createdAt")
       VALUES (gen_random_uuid(), $1, $1, NOW())
       ON CONFLICT (code) DO NOTHING`,
      [code],
    );
  }

  const permissions = await client.query(
    `SELECT id, code FROM "Permission" WHERE code = ANY($1)`,
    [SALES_FUNNEL_PERMISSIONS],
  );

  for (const permission of permissions.rows) {
    await client.query(
      `INSERT INTO "RolePermission" ("roleId", "permissionId", "createdAt")
       VALUES ($1, $2, NOW())
       ON CONFLICT DO NOTHING`,
      [roleId, permission.id],
    );
  }
}

/** Garante permissões do Funil em todos os papéis Administrador (idempotente). */
export async function ensureSalesFunnelPermissionsForAllAdmins(client) {
  const roles = await client.query(
    `SELECT id FROM "Role" WHERE name = 'Administrador'`,
  );
  for (const role of roles.rows) {
    await ensureSalesFunnelPermissions(client, role.id);
  }
  return roles.rowCount;
}

export async function ensureSalesFunnelPermissionsForUser(client, adminEmail) {
  const memberships = await client.query(
    `SELECT tm."roleId"
     FROM "TenantMember" tm
     JOIN "User" u ON u.id = tm."userId"
     WHERE lower(u.email) = lower($1) AND tm.status = 'ACTIVE'`,
    [adminEmail],
  );

  for (const row of memberships.rows) {
    await ensureSalesFunnelPermissions(client, row.roleId);
  }

  return memberships.rowCount;
}
