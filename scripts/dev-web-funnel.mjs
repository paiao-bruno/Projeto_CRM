#!/usr/bin/env node
/**
 * Inicia SOMENTE apps/web com rotas /api internas (Next.js Route Handlers).
 * Não inicia apps/api, NestJS, dist/main.js nem sincronização SGP.
 */
import { spawn, spawnSync } from "node:child_process";
import { runPreflight, REPO_ROOT } from "./preflight.mjs";
import { syncWebOnlyEnv } from "./sync-web-only-env.mjs";

process.chdir(REPO_ROOT);
await runPreflight({ skipDatabase: false });
syncWebOnlyEnv();

process.env.NEXT_PUBLIC_API_URL = "/api";
process.env.NEXT_PUBLIC_WEB_ONLY_MODE = "true";
process.env.SGP_AUTO_SYNC_ENABLED = "false";

function runSync(label, command, args) {
  console.log(`\n[dev:web:funnel] ${label}...`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runSync("Verificando banco", "node", ["scripts/ensure-db.mjs"]);
runSync("Gerando Prisma Client", "npm", ["run", "prisma:generate"]);
runSync("Aplicando migrations", "npm", ["run", "db:migrate:deploy"]);

console.log("\n[dev:web:funnel] Iniciando somente apps/web (sem apps/api)...");
console.log("[dev:web:funnel] API interna: http://localhost:3000/api");
console.log("[dev:web:funnel] Funil: http://localhost:3000/sales-funnel\n");

const WEB_ARGS = ["run", "dev", "-w", "apps/web"];
if (WEB_ARGS.some((arg) => arg.includes("apps/api"))) {
  console.error("[dev:web:funnel] ABORTADO: tentativa de iniciar apps/api.");
  process.exit(1);
}

const child = spawn("npm", WEB_ARGS, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 0));

process.on("SIGINT", () => {
  child.kill("SIGTERM");
  process.exit(0);
});
