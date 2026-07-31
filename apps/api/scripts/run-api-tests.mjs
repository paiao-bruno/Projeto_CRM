#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function collectTests(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectTests(full, acc);
    } else if (entry.endsWith(".spec.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

const tests = collectTests(join(apiRoot, "src"));
if (tests.length === 0) {
  console.error("Nenhum teste .spec.ts encontrado em apps/api/src");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--test", "-r", "ts-node/register", ...tests],
  {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  },
);

process.exit(result.status ?? 1);
