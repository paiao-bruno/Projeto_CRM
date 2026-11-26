import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./preflight.mjs";
import { resolveJwtSecretForDev } from "./lib/jwt-secret.mjs";

const WEB_ENV_PATH = join(REPO_ROOT, "apps/web/.env.development.local");
const ROOT_ENV_PATH = join(REPO_ROOT, ".env");
const ENCRYPTION_KEYS = ["APP_ENCRYPTION_KEY", "ENCRYPTION_KEY"];

function readRootEnvMap() {
  const map = {};
  if (!existsSync(ROOT_ENV_PATH)) return map;
  for (const line of readFileSync(ROOT_ENV_PATH, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) map[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return map;
}

function readDatabaseUrl() {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  const fromRoot = readRootEnvMap().DATABASE_URL?.trim();
  return fromRoot || "postgresql://crm:crm@localhost:5432/isp_crm?schema=public";
}

export function syncWebOnlyEnv() {
  const databaseUrl = readDatabaseUrl();
  const jwtSecret = resolveJwtSecretForDev({
    env: { ...process.env, NODE_ENV: "development" },
  });
  const root = readRootEnvMap();
  const extra = [];
  for (const key of ENCRYPTION_KEYS) {
    const value = process.env[key]?.trim() || root[key];
    if (value) extra.push(`${key}=${value}`);
  }

  const contents = `# Gerado automaticamente por npm run dev (nao commitar)
DATABASE_URL=${databaseUrl}
JWT_ACCESS_SECRET=${jwtSecret}
${extra.length ? `${extra.join("\n")}\n` : ""}`;

  writeFileSync(WEB_ENV_PATH, contents, "utf8");
  console.log(`[dev] Env local gravado em apps/web/.env.development.local`);
  return WEB_ENV_PATH;
}

if (process.argv[1]?.endsWith("sync-web-only-env.mjs")) {
  syncWebOnlyEnv();
}
