#!/usr/bin/env node
/**
 * Sobe a API no Windows/Linux/macOS sem depender de nest start.
 * 1) sincroniza constantes
 * 2) compila com nest build (gera dist/main.js)
 * 3) verifica o arquivo
 * 4) executa node dist/main.js com rebuild em watch
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(root, "apps/api");
const mainJs = join(apiDir, "dist/main.js");

function cleanApiBuildCache() {
  rmSync(join(apiDir, "tsconfig.build.tsbuildinfo"), { force: true });
}

function runSync(label, command, args, cwd = root) {
  console.log(`\n[api-dev] ${label}...`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(`\n[api-dev] Falhou em: ${label}`);
    process.exit(result.status ?? 1);
  }
}

function listDistHint() {
  const distDir = join(apiDir, "dist");
  console.error("\n[api-dev] dist/main.js não foi gerado.");
  console.error(`[api-dev] Caminho esperado: ${mainJs}`);

  if (!existsSync(distDir)) {
    console.error("[api-dev] A pasta dist/ não existe — o build não produziu saída.");
    console.error(
      "[api-dev] Tente manualmente: cd apps/api && npx nest build && dir dist\\main.js",
    );
    return;
  }

  console.error("[api-dev] Arquivos em dist/:");
  for (const entry of readdirSync(distDir, { recursive: true })) {
    console.error(`  - dist/${entry}`);
  }
}

runSync("Sincronizando constantes", "node", [join(root, "scripts/sync-shared-constants.mjs")]);
cleanApiBuildCache();
runSync("Compilando API (nest build)", "npx", ["nest", "build"], apiDir);

if (!existsSync(mainJs)) {
  listDistHint();
  process.exit(1);
}

console.log(`\n[api-dev] OK: ${mainJs}`);
console.log("[api-dev] Iniciando servidor...\n");

const buildWatch = spawn("npx", ["nest", "build", "--watch"], {
  cwd: apiDir,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

const server = spawn(process.execPath, ["--watch", mainJs], {
  cwd: apiDir,
  stdio: "inherit",
  env: process.env,
});

function shutdown(code = 0) {
  if (!buildWatch.killed) buildWatch.kill("SIGTERM");
  if (!server.killed) server.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

buildWatch.on("exit", (code) => {
  if (code && code !== 0) shutdown(code);
});

server.on("exit", (code) => {
  shutdown(code ?? 0);
});
