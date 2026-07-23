#!/usr/bin/env node
/**
 * Bootstrap seguro e idempotente para primeiro uso em produção.
 *
 * Variáveis obrigatórias:
 *   BOOTSTRAP_TENANT_NAME
 *   BOOTSTRAP_TENANT_SLUG
 *   BOOTSTRAP_ADMIN_NAME
 *   BOOTSTRAP_ADMIN_EMAIL
 *   BOOTSTRAP_ADMIN_PASSWORD
 *
 * Opcional:
 *   DATABASE_URL
 */
import bcrypt from "bcryptjs";
import { Client } from "pg";
import {
  bootstrapProduction,
  readBootstrapConfig,
  validateBootstrapConfig,
} from "./lib/bootstrap-production.mjs";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://crm:crm@localhost:5432/isp_crm?schema=public";

async function main() {
  const config = readBootstrapConfig(process.env);
  validateBootstrapConfig(config);

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const result = await bootstrapProduction(client, config, bcrypt.hash);
    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId: result.tenantId,
          tenantSlug: result.tenantSlug,
          adminEmail: result.adminEmail,
          userCreated: result.userCreated,
          message: result.userCreated
            ? "Administrador inicial criado com sucesso."
            : "Bootstrap idempotente concluído; usuário já existia.",
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
