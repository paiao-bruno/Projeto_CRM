#!/usr/bin/env node
/**
 * prisma:validate:migrations — validação em camadas das migrations.
 *
 * Modo padrão (completo): exige TEST_DATABASE_ADMIN_URL e cria bancos exclusivos da execução.
 * Falta de pré-requisito = FALHA (exit != 0), nunca sucesso silencioso.
 * `--static-only`: roda só as camadas 1-2 e declara, em voz alta, que 3-5 NÃO foram verificadas.
 */
import {
  assertNoDrift,
  checkAppliedHistory,
  checkSchemaSyntax,
  checkStatic,
  checkUpgradeFromLegacy,
} from "./lib/migration-checks.mjs";
import { migrateDeploy, runCli, withDisposableDatabases } from "./lib/test-db-harness.mjs";

const staticOnly = process.argv.includes("--static-only");

await runCli(async () => {
  const folders = checkStatic();
  console.log(`[1/5] estática OK (${folders.length} migrations): ${folders.join(", ")}`);
  checkSchemaSyntax();
  console.log("[2/5] prisma validate OK");

  if (staticOnly) {
    console.log("[3-5/5] NÃO VERIFICADO (--static-only): histórico em banco vazio, divergência e atualização.");
    return;
  }

  await withDisposableDatabases({ shadow: true }, async (ctx) => {
    migrateDeploy(ctx);
    await checkAppliedHistory(ctx, folders);
    console.log(`[3/5] histórico completo aplicado em banco vazio (${ctx.databaseName}) OK`);
    assertNoDrift(ctx, { from: "migrations" });
    assertNoDrift(ctx, { from: "database" });
    console.log("[4/5] sem divergência: migrations×schema (shadow distinto) e banco migrado×schema OK");
  });

  const lines = await withDisposableDatabases({}, (ctx) => checkUpgradeFromLegacy(ctx));
  console.log("[5/5] atualização a partir do estado anterior à migration Vértice OK:");
  for (const line of lines) console.log(`      - ${line}`);
});
