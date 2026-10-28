#!/usr/bin/env node
/**
 * Fluxo padrão de desenvolvimento do site único: Next.js (:3000) + worker da caixa de saída.
 * Não inicia apps/api (NestJS) nem qualquer integração externa.
 */
import { REPO_ROOT, runPreflight } from "./preflight.mjs";
import { syncWebOnlyEnv } from "./sync-web-only-env.mjs";
import { killTree, runStep, spawnManaged } from "./lib/proc.mjs";

process.chdir(REPO_ROOT);
await runPreflight({ skipDatabase: false });
syncWebOnlyEnv();

runStep("dev: Verificando banco", "node", ["scripts/ensure-db.mjs"]);
runStep("dev: Gerando Prisma Client", "npm", ["run", "prisma:generate"]);
runStep("dev: Aplicando migrations", "npm", ["run", "db:migrate:deploy"]);
runStep("dev: Permissões do Funil (idempotente)", "node", ["scripts/ensure-sales-funnel-permissions.mjs"]);

console.log("\n[dev] Site: http://localhost:3000  (API interna em /api; nenhum servidor NestJS)\n");

const web = spawnManaged("npm", ["run", "dev", "-w", "apps/web"]);
const worker = spawnManaged("node", ["scripts/outbox-worker.mjs"]);

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  killTree(web.child);
  killTree(worker.child);
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
web.exited.then(({ code }) => shutdown(code));
worker.exited.then(({ code }) => {
  if (!shuttingDown) console.error(`[dev] worker encerrou (código ${code}); o site segue ativo, mas envios ficam pendentes.`);
});
