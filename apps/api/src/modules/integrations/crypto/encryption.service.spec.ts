import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EncryptionService } from "./encryption.service";

function createConfig(key: string) {
  return {
    get<T = string>(name: string): T | undefined {
      return name === "ENCRYPTION_KEY" ? (key as T) : undefined;
    },
  };
}

describe("EncryptionService", () => {
  it("encrypts and decrypts json payloads", () => {
    const service = new EncryptionService(
      createConfig("test-key-with-at-least-32-characters-long") as never,
    );
    const encrypted = service.encryptJson({ app: "siac", token: "secret-token" });
    const decrypted = service.decryptJson<{ app: string; token: string }>(encrypted);

    assert.equal(decrypted.app, "siac");
    assert.equal(decrypted.token, "secret-token");
    assert.notEqual(encrypted, JSON.stringify(decrypted));
  });
});
