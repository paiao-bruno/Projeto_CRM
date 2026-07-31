#!/usr/bin/env node
/**
 * dev:web delega ao fluxo oficial web-only (dev:web:funnel).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

console.log("[dev:web] Redirecionando para o fluxo oficial npm run dev:web:funnel...\n");

const result = spawnSync("node", [join(root, "scripts/dev-web-funnel.mjs")], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

process.exit(result.status ?? 0);
