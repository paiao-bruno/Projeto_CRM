#!/usr/bin/env node
/**
 * Auditoria histórica da regressão SGP via Git.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
}

const report = {
  generatedAt: new Date().toISOString(),
  lastKnownGoodCommit: "059a223",
  lastKnownGoodDescription:
    "Antes de 9359ac3 — fallback entre /api/v1/fechamento/clientes/ e /api/ura/clientes/",
  regressionIntroducedCommit: "9359ac3",
  regressionIntroducedDescription:
    "Remove fallback fechamento/integra; passa a usar somente /api/ura/clientes/ (sem contratos/títulos)",
  regressionAmplifiedCommit: "c94c00b",
  regressionAmplifiedDescription:
    "Reconciliação soft-delete remove contratos/faturas ausentes do payload de clientes",
  partialFixCommit: "86cdd48",
  partialFixDescription:
    "Guardas de reconciliação quando payload não inclui filhos",
  definitiveFixCommit: "ccd9fb0",
  definitiveFixDescription:
    "Sync dedicada via /api/contrato/list/ e /api/ura/titulos/",
  changedFiles: sh("git diff --name-only 9359ac3^..9359ac3 -- apps/api/src/modules/integrations/"),
  changedFunctions: [
    "SgpClientService.discoverCustomers() — remove requestWithFallback",
    "IntegrationsService.extractCustomers() — attachUraRelations",
    "IntegrationsService.mapSgpCustomer() — passa a depender de filhos no payload",
  ],
  timeline: sh(
    'git log --oneline 9359ac3^..ccd9fb0 -- apps/api/src/modules/integrations/',
  ).split("\n"),
};

fs.writeFileSync(
  path.join(ROOT, "sgp-regression-audit.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
