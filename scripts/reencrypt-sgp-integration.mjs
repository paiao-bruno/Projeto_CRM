#!/usr/bin/env node
/**
 * Rotina administrativa para re-criptografar Integration.encryptedSecrets (SGP)
 * ou restaurar ciphertext a partir de backup.
 *
 * Segredos somente via variáveis de ambiente — nunca via argumentos CLI.
 *
 * Modos:
 *   (padrão) --dry-run     Pré-visualiza re-criptografia; ROLLBACK
 *   --execute              Aplica re-criptografia; COMMIT
 *   --restore --backup-file=PATH [--execute]  Restaura ciphertext do backup
 */
import { Client } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readReencryptEnv,
  runReencryptOperation,
} from "./lib/reencrypt-sgp-integration.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const execute = argv.includes("--execute");
  const restore = argv.includes("--restore");
  const dryRun = argv.includes("--dry-run") || (!execute && !restore);
  const backupFileArg = argv.find((arg) => arg.startsWith("--backup-file="));
  const backupFile = backupFileArg ? backupFileArg.slice("--backup-file=".length) : null;

  if (execute && restore) {
    return {
      dryRun: false,
      write: true,
      mode: "restore",
      backupFile,
    };
  }

  let mode = "reencrypt";
  if (restore) {
    mode = "restore";
  }

  const write = execute;

  return {
    dryRun,
    write,
    mode,
    backupFile,
  };
}

function printReport(report) {
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = readReencryptEnv(process.env);

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    const report = await runReencryptOperation(client, {
      config,
      mode: args.mode,
      write: args.write,
      backupFilePath: args.backupFile,
      rootDir: ROOT,
    });

    printReport(report);

    if (!args.write) {
      console.error(
        `\nModo dry-run (${args.mode}). Nenhuma alteração foi confirmada. Use --execute para aplicar.`,
      );
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
