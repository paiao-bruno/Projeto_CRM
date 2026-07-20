import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const originalFetch = global.fetch;

describe("api client", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends login payload and returns parsed response", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    global.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
      requestedUrl = String(url);
      requestedInit = init;
      return new Response(
        JSON.stringify({
          accessToken: "token",
          user: { sub: "1", email: "admin@example.com", name: "Admin" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const { api } = await import("./api");
    const response = await api.login("admin@example.com", "secret");

    assert.match(requestedUrl, /\/auth\/login$/);
    assert.equal(requestedInit?.method, "POST");
    assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
      email: "admin@example.com",
      password: "secret",
    });
    assert.equal(response.accessToken, "token");
  });

  it("throws API error messages from JSON payloads", async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ message: "Credenciais invalidas." }), {
        status: 401,
      })) as typeof fetch;

    const { api } = await import("./api");
    await assert.rejects(
      () => api.get("/auth/me", "bad-token"),
      /Credenciais invalidas/,
    );
  });

  it("returns undefined for 204 responses", async () => {
    global.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;

    const { api } = await import("./api");
    const response = await api.delete("/customers/1", "token");
    assert.equal(response, undefined);
  });

  it("adds bearer token when provided", async () => {
    let authorization = "";
    global.fetch = (async (_url, init) => {
      authorization = (init?.headers as Headers).get("Authorization") ?? "";
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const { api } = await import("./api");
    await api.get("/dashboard", "abc123");

    assert.equal(authorization, "Bearer abc123");
  });
});
