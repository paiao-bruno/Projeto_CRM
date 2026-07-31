#!/usr/bin/env node
/**
 * Bootstrap administrativo idempotente para modo web-only (desenvolvimento local).
 * Nunca executa automaticamente. Não permitido em produção.
 */
import bcrypt from "bcryptjs";
import { Client } from "pg";
import {
  assertMigrationsApplied,
  bootstrapProduction,
  normalizeEmail,
  normalizeSlug,
  PRODUCTION_PERMISSIONS,
  PLACEHOLDER_VALUES,
} from "./lib/bootstrap-production.mjs";
import { parseDatabaseTarget } from "./lib/disposable-db.mjs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function readConfig(env = process.env) {
  return {
    tenantName: env.WEB_BOOTSTRAP_TENANT_NAME?.trim(),
    tenantSlug: normalizeSlug(env.WEB_BOOTSTRAP_TENANT_SLUG),
    adminName: env.WEB_BOOTSTRAP_ADMIN_NAME?.trim(),
    adminEmail: normalizeEmail(env.WEB_BOOTSTRAP_ADMIN_EMAIL),
    adminPassword: env.WEB_BOOTSTRAP_ADMIN_PASSWORD ?? "",
    databaseUrl:
      env.DATABASE_URL ??
      "postgresql://crm:crm@localhost:5432/isp_crm?schema=public",
  };
}

function validateConfig(config) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("bootstrap:web-only não é permitido em produção.");
  }

  const missing = [];
  if (!config.tenantName) missing.push("WEB_BOOTSTRAP_TENANT_NAME");
  if (!config.tenantSlug) missing.push("WEB_BOOTSTRAP_TENANT_SLUG");
  if (!config.adminName) missing.push("WEB_BOOTSTRAP_ADMIN_NAME");
  if (!config.adminEmail) missing.push("WEB_BOOTSTRAP_ADMIN_EMAIL");
  if (!config.adminPassword) missing.push("WEB_BOOTSTRAP_ADMIN_PASSWORD");

  if (missing.length > 0) {
    throw new Error(`Variáveis obrigatórias ausentes: ${missing.join(", ")}`);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.adminEmail)) {
    throw new Error("WEB_BOOTSTRAP_ADMIN_EMAIL inválido.");
  }

  if (config.adminPassword.length < 12) {
    throw new Error("WEB_BOOTSTRAP_ADMIN_PASSWORD deve ter ao menos 12 caracteres.");
  }

  for (const value of [
    config.tenantName,
    config.tenantSlug,
    config.adminName,
    config.adminEmail,
    config.adminPassword,
  ]) {
    if (PLACEHOLDER_VALUES.has(String(value).trim().toLowerCase())) {
      throw new Error("Valores placeholder ou fracos não são permitidos.");
    }
  }

  const target = parseDatabaseTarget(config.databaseUrl);
  if (!LOCAL_HOSTS.has(target.host)) {
    throw new Error(
      `Bootstrap recusado: host "${target.host}" não é local. Use localhost/127.0.0.1.`,
    );
  }

  console.log(
    `[bootstrap:web-only] Alvo: host=${target.host} port=${target.port} db=${target.database} schema=${target.schema}`,
  );
}

async function main() {
  const config = readConfig();
  validateConfig(config);

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    await assertMigrationsApplied(client);

    const existing = await client.query(
      `SELECT id FROM "User" WHERE email = $1 LIMIT 1`,
      [config.adminEmail],
    );

    if (existing.rows.length > 0) {
      console.log(
        JSON.stringify(
          {
            status: "exists",
            adminEmail: config.adminEmail,
            message: "Administrador já existe. Senha não foi alterada.",
          },
          null,
          2,
        ),
      );
      return;
    }

    const result = await bootstrapProduction(
      client,
      {
        tenantName: config.tenantName,
        tenantSlug: config.tenantSlug,
        adminName: config.adminName,
        adminEmail: config.adminEmail,
        adminPassword: config.adminPassword,
      },
      bcrypt.hash,
    );

    console.log(
      JSON.stringify(
        {
          status: "created",
          tenantId: result.tenantId,
          tenantSlug: result.tenantSlug,
          adminEmail: result.adminEmail,
          permissions: PRODUCTION_PERMISSIONS.filter((p) => p.startsWith("sales_funnel")),
          message: "Administrador web-only criado com sucesso.",
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[bootstrap:web-only] ${error.message}`);
  process.exit(1);
});
