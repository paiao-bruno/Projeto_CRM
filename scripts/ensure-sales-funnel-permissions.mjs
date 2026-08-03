#!/usr/bin/env node
/**
 * Garante sales_funnel.read e sales_funnel.manage de forma idempotente.
 * Não altera senhas, tenants nem dados do Funil.
 */
import { Client } from "pg";
import {
  assertMigrationsApplied,
  ensureSalesFunnelPermissionsForAllAdmins,
  ensureSalesFunnelPermissionsForUser,
} from "./lib/bootstrap-production.mjs";
import { parseDatabaseTarget } from "./lib/disposable-db.mjs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://crm:crm@localhost:5432/isp_crm?schema=public";

  const target = parseDatabaseTarget(databaseUrl);
  if (!LOCAL_HOSTS.has(target.host)) {
    throw new Error(`Recusado: host "${target.host}" não é local.`);
  }
  if (target.database.toLowerCase().includes("test") || target.database.endsWith("_e2e")) {
    throw new Error("Use o banco principal isp_crm para este script.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await assertMigrationsApplied(client);

    const email = process.env.GRANT_FUNNEL_EMAIL?.trim();
    const rolesUpdated = email
      ? await ensureSalesFunnelPermissionsForUser(client, email)
      : await ensureSalesFunnelPermissionsForAllAdmins(client);

    console.log(
      JSON.stringify(
        {
          ok: true,
          database: target.database,
          scope: email ? `user:${email}` : "all-admin-roles",
          rolesUpdated,
          permissions: ["sales_funnel.read", "sales_funnel.manage"],
          message:
            "Permissões do Funil garantidas. Faça logout/login para atualizar o token JWT.",
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
