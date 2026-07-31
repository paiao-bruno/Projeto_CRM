/**
 * Aplica migrations Prisma em banco descartável sem exigir superuser para pgvector.
 * Substitui vector(1536) por TEXT quando a extensão vector não puder ser criada.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = join(repoRoot, "prisma/migrations");

function stripVectorRequirements(sql) {
  return sql
    .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";?\s*/gi, "")
    .replace(/CREATE EXTENSION IF NOT EXISTS "vector";?\s*/gi, "")
    .replace(/vector\s*\(\s*1536\s*\)/gi, "TEXT");
}

function listMigrationFolders() {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function tryCreateVectorExtension(client) {
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "vector"');
    return true;
  } catch {
    return false;
  }
}

async function recordPrismaMigrations(client, folders) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      id VARCHAR(36) PRIMARY KEY,
      checksum VARCHAR(64) NOT NULL,
      finished_at TIMESTAMPTZ,
      migration_name VARCHAR(255) NOT NULL,
      logs TEXT,
      rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  for (const folder of folders) {
    const sqlPath = join(migrationsDir, folder, "migration.sql");
    if (!existsSync(sqlPath)) continue;
    const raw = readFileSync(sqlPath, "utf8");
    const checksum = createHash("sha256").update(raw).digest("hex");
    await client.query(
      `INSERT INTO "_prisma_migrations"
        (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
       VALUES ($1, $2, NOW(), $3, NOW(), 1)
       ON CONFLICT (id) DO NOTHING`,
      [randomUUID(), checksum, folder],
    );
  }
}

export async function applyDisposableMigrations(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    const hasVector = await tryCreateVectorExtension(client);
    const folders = listMigrationFolders();

    for (const folder of folders) {
      const sqlPath = join(migrationsDir, folder, "migration.sql");
      if (!existsSync(sqlPath)) continue;

      let sql = readFileSync(sqlPath, "utf8");
      if (!hasVector) {
        sql = stripVectorRequirements(sql);
      }

      try {
        await client.query(sql);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("already exists")) {
          throw error;
        }
      }
    }

    await recordPrismaMigrations(client, folders);
  } finally {
    await client.end();
  }
}
