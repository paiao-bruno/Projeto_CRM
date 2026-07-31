#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = join(root, "apps/api/src/shared");
const source = join(root, "shared/sales-funnel.constants.ts");
const target = join(targetDir, "sales-funnel.constants.ts");

mkdirSync(targetDir, { recursive: true });

const banner = `/**
 * Fonte canônica: shared/sales-funnel.constants.ts
 * Gerado por scripts/sync-shared-constants.mjs
 */
`;

const body = readFileSync(source, "utf8").replace(/^\/\*\*[\s\S]*?\*\/\s*/m, "");
writeFileSync(target, banner + body);
console.log("Constantes do funil sincronizadas em apps/api/src/shared/");
