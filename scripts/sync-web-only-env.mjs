import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./preflight.mjs";
import { resolveJwtSecretForDev } from "./lib/jwt-secret.mjs";

const WEB_ENV_PATH = join(REPO_ROOT, "apps/web/.env.development.local");

function readDatabaseUrl() {
  const rootEnv = join(REPO_ROOT, ".env");
  if (!existsSync(rootEnv)) {
    return "postgresql://crm:crm@localhost:5432/isp_crm?schema=public";
  }
  const match = readFileSync(rootEnv, "utf8").match(/^DATABASE_URL=(.+)$/m);
  return match?.[1]?.trim() ?? "postgresql://crm:crm@localhost:5432/isp_crm?schema=public";
}

export function syncWebOnlyEnv() {
  const databaseUrl = readDatabaseUrl();
  const jwtSecret = resolveJwtSecretForDev({
    env: { ...process.env, NODE_ENV: "development" },
  });

  const contents = `# Gerado automaticamente por npm run dev (nao commitar)
DATABASE_URL=${databaseUrl}
JWT_ACCESS_SECRET=${jwtSecret}
`;

  writeFileSync(WEB_ENV_PATH, contents, "utf8");
  console.log(`[dev] Env local gravado em apps/web/.env.development.local`);
  return WEB_ENV_PATH;
}

if (process.argv[1]?.endsWith("sync-web-only-env.mjs")) {
  syncWebOnlyEnv();
}
