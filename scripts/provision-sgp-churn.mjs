#!/usr/bin/env node
/**
 * Grava a leitura SGP de cancelamentos pelo serviço canônico (Integration cifrada).
 * Credenciais só via ambiente / .env — nunca em argv.
 *
 *   SGP_API_URL              (padrão https://webmais.sgp.net.br)
 *   SGP_APP                  (padrão vertice_crm)
 *   SGP_TOKEN                (obrigatório; segredo real da aplicação)
 *   SGP_CHURN_TENANT_SLUG    (obrigatório; não usa o primeiro tenant)
 *   DATABASE_URL
 *   APP_ENCRYPTION_KEY       (produção) ou apps/web/.secret-box.local (dev)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "apps/web");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

loadEnvFile(join(webDir, ".env.development.local"));
loadEnvFile(join(root, ".env"));

const runner = join(webDir, "src/server/sgp-churn-provision-main.ts");
const result = spawnSync(
  process.execPath,
  ["-r", "ts-node/register/transpile-only", runner],
  {
    cwd: webDir,
    stdio: "inherit",
    env: {
      ...process.env,
      TS_NODE_PROJECT: join(webDir, "tsconfig.worker.json"),
      TS_NODE_TRANSPILE_ONLY: "true",
    },
  },
);
process.exit(result.status ?? 1);
