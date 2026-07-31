import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isWebOnlyModeFromEnv,
  resolveApiBaseUrlFromEnv,
  isLegacyApiRoute,
} from "./runtime-config";

describe("runtime-config", () => {
  it("detects web-only mode from env", () => {
    assert.equal(isWebOnlyModeFromEnv({ NEXT_PUBLIC_WEB_ONLY_MODE: "true" }), true);
    assert.equal(isWebOnlyModeFromEnv({ NEXT_PUBLIC_WEB_ONLY_MODE: "false" }), false);
  });

  it("web-only ativo ignora URL legada apontando para porta 4000", () => {
    assert.equal(
      resolveApiBaseUrlFromEnv({
        NEXT_PUBLIC_WEB_ONLY_MODE: "true",
        NEXT_PUBLIC_API_URL: "http://localhost:4000/api",
      }),
      "/api",
    );
  });

  it("modo completo permite URL da API NestJS", () => {
    assert.equal(
      resolveApiBaseUrlFromEnv({ NEXT_PUBLIC_API_URL: "http://localhost:4000/api" }),
      "http://localhost:4000/api",
    );
  });

  it("web-only sem URL explícita retorna /api", () => {
    assert.equal(
      resolveApiBaseUrlFromEnv({ NEXT_PUBLIC_WEB_ONLY_MODE: "true" }),
      "/api",
    );
  });

  it("configuração ausente usa fallback legacy 4000", () => {
    assert.equal(resolveApiBaseUrlFromEnv({}), "http://localhost:4000/api");
  });

  it("configuração inválida vazia cai no fallback legacy", () => {
    assert.equal(
      resolveApiBaseUrlFromEnv({ NEXT_PUBLIC_API_URL: "   " }),
      "http://localhost:4000/api",
    );
  });

  it("identifies legacy API routes", () => {
    assert.equal(isLegacyApiRoute("/customers"), true);
    assert.equal(isLegacyApiRoute("/sales-funnel"), false);
  });
});

describe("runtime-config client bundle representation", () => {
  it("simula código inlined do Next.js para web-only", () => {
    const env = {
      NEXT_PUBLIC_WEB_ONLY_MODE: "true",
      NEXT_PUBLIC_API_URL: "http://localhost:4000/api",
    } as Record<string, string | undefined>;

    const webOnlyFlag = env.NEXT_PUBLIC_WEB_ONLY_MODE === "true";
    const apiBase = webOnlyFlag
      ? "/api"
      : env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:4000/api";

    assert.equal(webOnlyFlag, true);
    assert.equal(apiBase, "/api");
  });

  it("simula bundle legacy quando web-only está desligado", () => {
    const env = {
      NEXT_PUBLIC_WEB_ONLY_MODE: "false",
      NEXT_PUBLIC_API_URL: "http://localhost:4000/api",
    } as Record<string, string | undefined>;

    const webOnlyFlag = env.NEXT_PUBLIC_WEB_ONLY_MODE === "true";
    const apiBase = webOnlyFlag
      ? "/api"
      : env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:4000/api";

    assert.equal(webOnlyFlag, false);
    assert.equal(apiBase, "http://localhost:4000/api");
  });
});

describe("legacy pages web-only behavior", () => {
  it("páginas legadas devem reconhecer web-only via flag pública", () => {
    assert.equal(isWebOnlyModeFromEnv({ NEXT_PUBLIC_WEB_ONLY_MODE: "true" }), true);
    assert.equal(isLegacyApiRoute("/dashboard"), true);
    assert.equal(isLegacyApiRoute("/integrations"), true);
  });
});
