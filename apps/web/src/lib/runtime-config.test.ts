import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveApiBaseUrl } from "./runtime-config";

describe("runtime-config", () => {
  it("usa sempre a mesma origem, sem depender de variáveis de ambiente do legado", () => {
    const previous = process.env.NEXT_PUBLIC_API_URL;
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000/api";
    try {
      assert.equal(resolveApiBaseUrl(), "/api");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_API_URL;
      else process.env.NEXT_PUBLIC_API_URL = previous;
    }
  });
});
