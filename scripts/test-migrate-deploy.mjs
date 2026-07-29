#!/usr/bin/env node
/**
 * Valida que `prisma migrate deploy` cria o schema completo a partir de um banco vazio.
 * Requer PostgreSQL com extensões pgcrypto e vector (ex: docker compose up postgres).
 */
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://crm:crm@localhost:5432/isp_crm?schema=public";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
  } catch (error) {
    console.error(
      "Não foi possível conectar ao PostgreSQL. Inicie com: docker compose up -d postgres",
    );
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.end();

  run("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]);

  const verify = new Client({ connectionString: DATABASE_URL });
  await verify.connect();
  const tables = await verify.query(
    `SELECT COUNT(*)::int AS c FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const migrations = await verify.query(
    `SELECT COUNT(*)::int AS c FROM "_prisma_migrations"`,
  );
  await verify.end();

  console.log(
    JSON.stringify(
      {
        tables: tables.rows[0].c,
        migrationsApplied: migrations.rows[0].c,
        ok: tables.rows[0].c > 0 && migrations.rows[0].c > 0,
      },
      null,
      2,
    ),
  );

  if (tables.rows[0].c === 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
