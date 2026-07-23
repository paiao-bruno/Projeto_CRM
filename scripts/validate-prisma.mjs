import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const migrationsDir = path.join(root, "prisma/migrations");
const lockFile = path.join(migrationsDir, "migration_lock.toml");
const schemaFile = path.join(root, "prisma/schema.prisma");

function fail(message) {
  console.error(`[prisma:validate:migrations] ${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(lockFile)) {
  fail("Arquivo migration_lock.toml ausente.");
}

const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (migrationFolders.length === 0) {
  fail("Nenhuma migration encontrada.");
}

for (const folder of migrationFolders) {
  const sqlPath = path.join(migrationsDir, folder, "migration.sql");
  if (!existsSync(sqlPath)) {
    fail(`Migration ${folder} não possui migration.sql.`);
  }

  const sql = readFileSync(sqlPath, "utf8");
  if (sql.includes("Loaded Prisma config")) {
    fail(`Migration ${folder} contém saída inválida do CLI Prisma.`);
  }
}

if (!migrationFolders.some((folder) => folder.endsWith("_init"))) {
  fail("Baseline init migration ausente (esperado diretório *_init).");
}

if (!existsSync(schemaFile)) {
  fail("schema.prisma ausente.");
}

console.log(`Migrations validadas (${migrationFolders.length}):`);
for (const folder of migrationFolders) {
  console.log(`- ${folder}`);
}

run("npm", ["run", "prisma:validate"]);

if (process.env.DATABASE_URL) {
  run("npx", [
    "prisma",
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-schema",
    "prisma/schema.prisma",
    "--exit-code",
  ]);
  console.log("Schema e migrations estão sincronizados.");
} else {
  console.log("DATABASE_URL não definido; diff de migrations ignorado.");
}

console.log("[prisma:validate:migrations] OK");
