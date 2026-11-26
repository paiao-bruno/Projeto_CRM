#!/usr/bin/env node
/**
 * Runtime de produção do site único: Next.js start + worker da caixa de saída (tick SGP).
 * Não inicia NestJS. Exige build prévio (`npm run build`).
 */
import { REPO_ROOT } from "./preflight.mjs";
import { syncWebOnlyEnv } from "./sync-web-only-env.mjs";
import { killTree, spawnManaged } from "./lib/proc.mjs";

process.chdir(REPO_ROOT);
syncWebOnlyEnv();

console.log("\n[start] Site: http://localhost:3000  (worker de outbox/SGP no mesmo comando)\n");

const web = spawnManaged("npm", ["run", "start", "-w", "apps/web"]);
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
  if (!shuttingDown) console.error(`[start] worker encerrou (código ${code}); o site segue ativo, mas a sincronização SGP para.`);
});
