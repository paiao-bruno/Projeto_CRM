import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    const rawKey = this.config.get<string>("ENCRYPTION_KEY");

    if (!rawKey) {
      throw new InternalServerErrorException(
        "ENCRYPTION_KEY precisa estar configurada para armazenar credenciais de integração.",
      );
    }

    this.key = createHash("sha256").update(rawKey).digest();
  }

  encrypt(value: string) {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  decrypt(payload: string) {
    const [ivPart, authTagPart, encryptedPart] = payload.split(".");

    if (!ivPart || !authTagPart || !encryptedPart) {
      throw new InternalServerErrorException("Credencial criptografada inválida.");
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTagPart, "base64url"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, "base64url")),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  }

  encryptJson(value: Record<string, unknown>) {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T extends Record<string, unknown>>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }
}
