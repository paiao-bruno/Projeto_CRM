import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export function deriveEncryptionKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") {
    throw new Error("ENCRYPTION_KEY precisa estar configurada.");
  }
  if (rawKey.length < 32) {
    throw new Error("ENCRYPTION_KEY deve ter ao menos 32 caracteres.");
  }
  return createHash("sha256").update(rawKey).digest();
}

export function encryptWithKey(rawKey, value) {
  const key = deriveEncryptionKey(rawKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptWithKey(rawKey, payload) {
  const key = deriveEncryptionKey(rawKey);
  const [ivPart, authTagPart, encryptedPart] = payload.split(".");

  if (!ivPart || !authTagPart || !encryptedPart) {
    throw new Error("Credencial criptografada inválida.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(authTagPart, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function encryptJsonWithKey(rawKey, value) {
  return encryptWithKey(rawKey, JSON.stringify(value));
}

export function decryptJsonWithKey(rawKey, payload) {
  return JSON.parse(decryptWithKey(rawKey, payload));
}

export function validateDecryptedSecrets(secrets) {
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
    throw new Error("Segredos descriptografados inválidos.");
  }
  const app = typeof secrets.app === "string" ? secrets.app.trim() : "";
  const token = typeof secrets.token === "string" ? secrets.token.trim() : "";
  if (!app || !token) {
    throw new Error("Segredos descriptografados incompletos.");
  }
  return { app, token };
}
