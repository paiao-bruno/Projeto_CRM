import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactSensitiveData, safeJsonStringify } from "./redact-sensitive.util";

describe("redact-sensitive.util", () => {
  it("redacts sensitive keys in nested payloads", () => {
    const redacted = redactSensitiveData({
      app: "siac",
      token: "secret-token",
      nested: {
        password: "admin123",
      },
    });

    assert.notEqual((redacted as { token: string }).token, "secret-token");
    assert.match(safeJsonStringify(redacted), /token":"se\*\*\*en"/);
  });
});
