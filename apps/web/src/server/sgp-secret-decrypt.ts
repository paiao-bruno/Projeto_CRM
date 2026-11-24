import { createDecipheriv, createHash } from "node:crypto";
import { decryptSecret } from "./secret-box";

function asSecrets(text: string): { app: string; token: string } | null {
  try {
    const parsed = JSON.parse(text) as { app?: unknown; token?: unknown };
    const app = typeof parsed.app === "string" ? parsed.app.trim() : "";
    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    if (!app || !token) return null;
    return { app, token };
  } catch {
    return null;
  }
}

function decryptNestBlob(payload: string, rawKey: string) {
  const [ivPart, authTagPart, encryptedPart] = payload.split(".");
  if (!ivPart || !authTagPart || !encryptedPart || payload.startsWith("v1.")) return null;
  try {
    const key = createHash("sha256").update(rawKey).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(authTagPart, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return asSecrets(decrypted);
  } catch {
    return null;
  }
}

/** Recupera App/Token de blobs v1 (site único) ou do formato Nest (ENCRYPTION_KEY). */
export function decryptSgpSecrets(encrypted: string | null | undefined): { app: string; token: string } | null {
  if (!encrypted) return null;
  try {
    if (encrypted.startsWith("v1.")) return asSecrets(decryptSecret(encrypted));
  } catch {
    /* chave v1 incompatível */
  }
  const legacyKey = process.env.ENCRYPTION_KEY?.trim();
  if (legacyKey && legacyKey.length >= 32) {
    const nested = decryptNestBlob(encrypted, legacyKey);
    if (nested) return nested;
  }
  return null;
}
