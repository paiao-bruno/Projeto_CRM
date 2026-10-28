import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Cifra segredos de conexões (AES-256-GCM). Chave: APP_ENCRYPTION_KEY (base64, 32 bytes).
 * Em desenvolvimento, sem a variável, uma chave local é gerada em apps/web/.secret-box.local (ignorada pelo git).
 * Em produção a variável é obrigatória.
 */
function webRoot() {
  const cwd = process.cwd();
  for (const candidate of [cwd, path.join(cwd, "apps", "web")]) {
    if (existsSync(path.join(candidate, "next.config.ts"))) return candidate;
  }
  return cwd;
}

function resolveKey(): Buffer {
  const fromEnv = process.env.APP_ENCRYPTION_KEY?.trim();
  if (fromEnv) {
    const key = Buffer.from(fromEnv, "base64");
    if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY deve ser base64 de 32 bytes.");
    return key;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_ENCRYPTION_KEY ausente. Configure a variável de ambiente.");
  }
  const file = path.join(webRoot(), ".secret-box.local");
  if (existsSync(file)) {
    const key = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
    if (key.length === 32) return key;
  }
  const generated = randomBytes(32);
  writeFileSync(file, `${generated.toString("base64")}\n`, { mode: 0o600 });
  return generated;
}

export function encryptSecret(plaintext: string, key: Buffer = resolveKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, key: Buffer = resolveKey()): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Formato de segredo inválido.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
