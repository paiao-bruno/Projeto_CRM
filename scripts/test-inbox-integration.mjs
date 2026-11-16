#!/usr/bin/env node
/**
 * Integração da caixa de entrada contra PostgreSQL real e isolado (banco exclusivo por execução).
 * Pré-requisito: TEST_DATABASE_ADMIN_URL (ver scripts/lib/test-db-harness.mjs).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  HarnessError,
  generatePrismaClient,
  migrateDeploy,
  repoRoot,
  runCli,
  withDisposableDatabases,
} from "./lib/test-db-harness.mjs";

const files = process.argv.slice(2);
const testFiles = files.length > 0 ? files : ["src/server/inbox/inbox.integration.ts"];

await runCli(async () => {
  await withDisposableDatabases({}, async (ctx) => {
    migrateDeploy(ctx);
    generatePrismaClient();
    const result = spawnSync(process.execPath, ["--test", "-r", "ts-node/register", ...testFiles], {
      cwd: join(repoRoot, "apps/web"),
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: ctx.databaseUrl,
        TEST_DATABASE_RUN_ID: ctx.runId,
        TS_NODE_PROJECT: join(repoRoot, "apps/web/tsconfig.test.json"),
      },
    });
    if (result.status !== 0) throw new HarnessError(`testes de integração falharam (exit ${result.status})`, "TESTS_FAILED");
  });
});
