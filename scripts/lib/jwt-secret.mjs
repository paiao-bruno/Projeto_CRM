import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SECRET_PATH = join(REPO_ROOT, "apps/web/.jwt-secret.local");
const MIN_LENGTH = 32;

export function resolveJwtSecretForDev(options = {}) {
  const env = options.env ?? process.env;
  const secretPath = options.secretPath ?? SECRET_PATH;
  const fromEnv = env.JWT_ACCESS_SECRET?.trim();
  if (fromEnv && fromEnv.length >= MIN_LENGTH) {
    return fromEnv;
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "JWT_ACCESS_SECRET ausente ou curto demais. Configure a variável de ambiente.",
    );
  }

  if (existsSync(secretPath)) {
    const stored = readFileSync(secretPath, "utf8").trim();
    if (stored.length >= MIN_LENGTH) {
      return stored;
    }
  }

  const generated = randomBytes(48).toString("base64url");
  mkdirSync(dirname(secretPath), { recursive: true });
  writeFileSync(secretPath, `${generated}\n`, { mode: 0o600 });
  return generated;
}
