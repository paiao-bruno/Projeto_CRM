import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  callSgpDirectWithRetry,
  classifyDirectSgpProbeResult,
  computeRetryDelayMs,
  DEFAULT_SGP_DIRECT_ENDPOINTS,
  findExistingCredential,
  fetchPaginatedWithRetry,
  normalizeSgpApiUrl,
  parseRetryAfterMs,
  redactSgpRequestUrl,
} from "./sgp-homologation.mjs";

describe("sgp-homologation", () => {
  it("normalizeSgpApiUrl ignores trailing slash and case", () => {
    assert.equal(
      normalizeSgpApiUrl("https://Example.SGP.net.br/"),
      normalizeSgpApiUrl("https://example.sgp.net.br"),
    );
    assert.equal(
      normalizeSgpApiUrl("https://example.sgp.net.br/api/"),
      "https://example.sgp.net.br/api",
    );
  });

  it("findExistingCredential matches normalized apiUrl", () => {
    const match = findExistingCredential(
      [
        { id: "cred-1", apiUrl: "https://Example.SGP.net.br/" },
        { id: "cred-2", apiUrl: "https://other.example.net.br/" },
      ],
      "https://example.sgp.net.br",
    );
    assert.equal(match?.id, "cred-1");
  });

  it("classifyDirectSgpProbeResult treats HTTP 405 on contracts as non-blocking direct probe", () => {
    const endpoint = DEFAULT_SGP_DIRECT_ENDPOINTS.find((item) => item.id === "sgp-contracts");
    const result = classifyDirectSgpProbeResult(endpoint, {
      ok: false,
      status: 405,
      requestUrl: "https://example.sgp.net.br/api/contrato/list/",
    });
    assert.equal(result.classification, "direct-probe-method-not-allowed");
    assert.equal(result.blocksProduction, false);
  });

  it("classifyDirectSgpProbeResult blocks production when customers probe fails", () => {
    const endpoint = DEFAULT_SGP_DIRECT_ENDPOINTS.find((item) => item.id === "sgp-customers");
    const result = classifyDirectSgpProbeResult(endpoint, {
      ok: false,
      status: 500,
      requestUrl: "https://example.sgp.net.br/api/ura/clientes/",
    });
    assert.equal(result.classification, "fail");
    assert.equal(result.blocksProduction, true);
  });

  it("parseRetryAfterMs respects numeric Retry-After seconds", () => {
    assert.equal(parseRetryAfterMs("2", 1000), 2000);
  });

  it("computeRetryDelayMs prefers Retry-After over exponential backoff", () => {
    assert.equal(computeRetryDelayMs(2, 3000, 1000), 3000);
    assert.equal(computeRetryDelayMs(2, null, 1000), 2000);
  });

  it("callSgpDirectWithRetry retries HTTP 429 deterministically", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls < 3) {
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return new Response(JSON.stringify({ clientes: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const result = await callSgpDirectWithRetry(
        {
          apiUrl: "https://example.sgp.net.br",
          app: "app",
          token: "token",
          timeoutMs: 5000,
        },
        "/api/ura/clientes/",
        { limit: 1 },
        {
          maxAttempts: 5,
          baseDelayMs: 1,
          sleep: async () => undefined,
        },
      );
      assert.equal(result.ok, true);
      assert.equal(result.attempts, 3);
      assert.equal(calls, 3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("callSgpDirectWithRetry reports exhaustion after max 429 attempts", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "0" },
      });

    try {
      const result = await callSgpDirectWithRetry(
        {
          apiUrl: "https://example.sgp.net.br",
          app: "app",
          token: "token",
          timeoutMs: 5000,
        },
        "/api/ura/clientes/",
        {},
        {
          maxAttempts: 3,
          baseDelayMs: 1,
          sleep: async () => undefined,
        },
      );
      assert.equal(result.rateLimitExhausted, true);
      assert.match(result.rateLimitDiagnostic, /HTTP 429/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fetchPaginatedWithRetry retries 429 and delays between pages", async () => {
    let pageCalls = 0;
    const sleeps = [];
    const pages = await fetchPaginatedWithRetry(
      async (page) => {
        pageCalls += 1;
        if (page === 1 && pageCalls === 1) {
          return { ok: false, status: 429, body: null, durationMs: 1, retryAfter: "0" };
        }
        if (page === 1 && pageCalls === 2) {
          return {
            ok: true,
            status: 200,
            body: { totalPages: 2, total: 2, data: [{ id: "1" }] },
            durationMs: 2,
          };
        }
        return {
          ok: true,
          status: 200,
          body: { totalPages: 2, total: 2, data: [{ id: "2" }] },
          durationMs: 3,
        };
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1,
        pageDelayMs: 5,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    assert.equal(pages.length, 2);
    assert.ok(sleeps.length >= 1);
  });

  it("redactSgpRequestUrl removes credentials from URL", () => {
    const redacted = redactSgpRequestUrl("https://user:secret@example.sgp.net.br/api/ura/clientes/");
    assert.doesNotMatch(redacted, /secret/);
    assert.match(redacted, /example\.sgp\.net\.br/);
  });

  it("repeated homologation reuses credential by normalized apiUrl", () => {
    const first = findExistingCredential(
      [{ id: "existing-id", apiUrl: "https://demo.sgp.net.br/" }],
      "https://DEMO.sgp.net.br",
    );
    const second = findExistingCredential(
      [{ id: "existing-id", apiUrl: "https://demo.sgp.net.br/" }],
      "https://demo.sgp.net.br///",
    );
    assert.equal(first?.id, "existing-id");
    assert.equal(second?.id, "existing-id");
  });
});
