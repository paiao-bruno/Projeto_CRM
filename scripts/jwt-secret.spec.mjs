import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveJwtSecretForDev } from "./lib/jwt-secret.mjs";

describe("jwt-secret dev script resolver", () => {
  it("gera e persiste segredo local quando ausente em desenvolvimento", () => {
    const dir = mkdtempSync(join(tmpdir(), "jwt-secret-test-"));
    const secretPath = join(dir, ".jwt-secret.local");

    const first = resolveJwtSecretForDev({
      env: { NODE_ENV: "development" },
      secretPath,
    });
    const second = resolveJwtSecretForDev({
      env: { NODE_ENV: "development" },
      secretPath,
    });

    assert.ok(first.length >= 32);
    assert.equal(first, second);
    assert.equal(existsSync(secretPath), true);
    assert.ok(!readFileSync(secretPath, "utf8").includes("\n\n"));

    rmSync(dir, { recursive: true, force: true });
  });

  it("falha em produção sem JWT_ACCESS_SECRET", () => {
    assert.throws(
      () =>
        resolveJwtSecretForDev({
          env: { NODE_ENV: "production" },
        }),
      /JWT_ACCESS_SECRET ausente/,
    );
  });
});
