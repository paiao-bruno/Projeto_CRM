#!/usr/bin/env node
/**
 * Inicia API + Web com SGP auto-sync desabilitado.
 * Compatível com Windows (PowerShell/CMD) e Linux/macOS.
 */
import { spawnSync } from "node:child_process";

process.env.SGP_AUTO_SYNC_ENABLED = "false";

function run(label, command, args) {
  console.log(`\n[dev:funnel] ${label}...`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("Sincronizando constantes", "node", ["scripts/sync-shared-constants.mjs"]);
run("Verificando banco", "node", ["scripts/ensure-db.mjs"]);
run("Gerando Prisma Client", "npm", ["run", "prisma:generate"]);
run("Aplicando migrations", "npm", ["run", "db:migrate:deploy"]);
run("Compilando API", "npm", ["run", "build", "-w", "apps/api"]);
run("Iniciando API e Web", "node", ["scripts/dev.mjs"]);
