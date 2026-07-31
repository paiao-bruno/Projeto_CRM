import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET_FILE = path.join(webRoot, ".jwt-secret.local");
const MIN_LENGTH = 32;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function readSecretFile(): string | null {
  if (!existsSync(SECRET_FILE)) {
    return null;
  }
  const value = readFileSync(SECRET_FILE, "utf8").trim();
  return value.length >= MIN_LENGTH ? value : null;
}

function writeSecretFile(secret: string) {
  writeFileSync(SECRET_FILE, `${secret}\n`, { mode: 0o600 });
}

function generateSecret(): string {
  return randomBytes(48).toString("base64url");
}

export function resolveJwtSecretRaw(): string {
  const fromEnv = process.env.JWT_ACCESS_SECRET?.trim();
  if (fromEnv && fromEnv.length >= MIN_LENGTH) {
    return fromEnv;
  }

  if (isProduction()) {
    throw new Error(
      "JWT_ACCESS_SECRET ausente ou curto demais. Configure a variável de ambiente.",
    );
  }

  const fromFile = readSecretFile();
  if (fromFile) {
    return fromFile;
  }

  const generated = generateSecret();
  writeSecretFile(generated);
  return generated;
}

export function jwtSecretKey() {
  return new TextEncoder().encode(resolveJwtSecretRaw());
}
