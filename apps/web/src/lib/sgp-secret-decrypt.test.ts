import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { encryptSecret } from "../server/secret-box";
import { decryptSgpSecrets } from "../server/sgp-secret-decrypt";

function nestEncrypt(rawKey: string, value: string) {
  const key = createHash("sha256").update(rawKey).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

describe("recuperação de App/Token", () => {
  it("lê blob v1 e blob Nest com ENCRYPTION_KEY estável", () => {
    const payload = JSON.stringify({ app: "webmais", token: "sgp-token" });
    const v1 = encryptSecret(payload);
    assert.deepEqual(decryptSgpSecrets(v1), { app: "webmais", token: "sgp-token" });
    const previous = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "homologation-encryption-key-32-chars-min";
    const nested = nestEncrypt(process.env.ENCRYPTION_KEY, payload);
    assert.deepEqual(decryptSgpSecrets(nested), { app: "webmais", token: "sgp-token" });
    if (previous === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previous;
  });
});
