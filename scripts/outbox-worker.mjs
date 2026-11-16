#!/usr/bin/env node
/**
 * Worker dedicado da caixa de saída (processo separado do Next.js).
 * Reivindica entregas com lease/fencing, usa o adaptador do canal e registra heartbeat.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "apps/web");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

loadEnvFile(join(webDir, ".env.development.local"));
loadEnvFile(join(root, ".env"));

if (!process.env.DATABASE_URL) {
  console.error("[outbox] DATABASE_URL ausente (defina no ambiente ou em .env).");
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ["-r", "ts-node/register/transpile-only", "src/server/outbox/worker-main.ts"],
  {
    cwd: webDir,
    stdio: "inherit",
    env: { ...process.env, TS_NODE_PROJECT: join(webDir, "tsconfig.worker.json"), TS_NODE_TRANSPILE_ONLY: "true" },
  },
);
const forward = (signal) => () => child.kill(signal);
process.on("SIGINT", forward("SIGINT"));
process.on("SIGTERM", forward("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
