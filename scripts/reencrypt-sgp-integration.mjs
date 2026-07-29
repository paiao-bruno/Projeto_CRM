#!/usr/bin/env node
/**
 * Rotina administrativa para re-criptografar Integration.encryptedSecrets (SGP)
 * ou restaurar ciphertext a partir de backup.
 *
 * Segredos somente via variáveis de ambiente — nunca via argumentos CLI.
 *
 * Modos:
 *   --preflight            Valida ambiente sem conectar ao banco
 *   (padrão) --dry-run     Pré-visualiza re-criptografia; ROLLBACK
 *   --execute              Aplica re-criptografia; COMMIT
 *   --restore --backup-file=PATH [--execute]  Restaura ciphertext do backup
 */
import { Client } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDatabaseUrlReadyForPg,
  collectReencryptValidationErrors,
  formatValidationFailure,
  readReencryptEnv,
  runPreflight,
  runReencryptOperation,
  sanitizePgConnectError,
  verifyDryRunProofForExecute,
} from "./lib/reencrypt-sgp-integration.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const execute = argv.includes("--execute");
  const restore = argv.includes("--restore");
  const preflight = argv.includes("--preflight");
  const dryRunExplicit = argv.includes("--dry-run");
  const backupFileArg = argv.find((arg) => arg.startsWith("--backup-file="));
  const proofArg = argv.find((arg) => arg.startsWith("--proof="));
  const backupFile = backupFileArg ? backupFileArg.slice("--backup-file=".length) : null;
  const proofToken = proofArg ? proofArg.slice("--proof=".length) : null;

  if (execute && restore) {
    return {
      preflight: false,
      dryRun: false,
      dryRunExplicit,
      write: true,
      mode: "restore",
      backupFile,
      proofToken,
    };
  }

  let mode = "reencrypt";
  if (restore) {
    mode = "restore";
  }

  const write = execute;
  const dryRun = !preflight && (dryRunExplicit || (!execute && !restore));

  return {
    preflight,
    dryRun,
    dryRunExplicit,
    write,
    mode,
    backupFile,
    proofToken,
  };
}

function printReport(report) {
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = readReencryptEnv(process.env);
  const proofToken = args.proofToken || config.dryRunProof;

  if (args.preflight) {
    const report = runPreflight(config, args, ROOT);
    printReport(report);
    process.exit(report.ok ? 0 : 1);
  }

  const validation = collectReencryptValidationErrors(config, { mode: args.mode, args });
  if (!validation.ok) {
    throw new Error(formatValidationFailure(validation));
  }
  assertDatabaseUrlReadyForPg(config.databaseUrl);

  if (args.write && args.mode === "reencrypt" && !config.skipDryRunProof && !proofToken) {
    throw new Error(
      "REENCRYPT_DRY_RUN_PROOF ausente. Execute dry-run e defina REENCRYPT_DRY_RUN_PROOF com o token retornado.",
    );
  }

  const client = new Client({ connectionString: config.databaseUrl });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(sanitizePgConnectError(error));
  }

  try {
    if (args.write && args.mode === "reencrypt" && !config.skipDryRunProof) {
      const proofStatus = await verifyDryRunProofForExecute(client, config, proofToken);
      console.error(
        `[guard] Comprovante de dry-run válido até ${proofStatus.expiresAt} (proofId=${proofStatus.proofId.slice(0, 12)}...).`,
      );
    }

    const report = await runReencryptOperation(client, {
      config,
      mode: args.mode,
      write: args.write,
      backupFilePath: args.backupFile,
      rootDir: ROOT,
      args,
    });

    printReport(report);

    if (!args.write) {
      console.error(
        `\nModo dry-run (${args.mode}). Nenhuma alteração foi confirmada. Use --execute para aplicar.`,
      );
      if (report.dryRunProof?.token) {
        console.error(
          "Defina REENCRYPT_DRY_RUN_PROOF com o token retornado em dryRunProof.token antes do --execute.",
        );
      }
      process.exit(0);
    }

    process.exit(0);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
