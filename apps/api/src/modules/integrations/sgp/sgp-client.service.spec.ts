import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { HttpException } from "@nestjs/common";
import { SgpClientService } from "./sgp-client.service";

function createConfig(values: Record<string, string>) {
  return {
    get<T = string>(key: string): T | undefined {
      return values[key] as T | undefined;
    },
  };
}

describe("SgpClientService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends token/app in payload and bearer authorization header", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    global.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
      requestedUrl = url.toString();
      requestedInit = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const service = new SgpClientService(
      createConfig({
        SGP_API_URL: "https://webmais.sgp.net.br",
        SGP_APP: "siac",
        SGP_TOKEN: "secret-token",
      }) as never,
    );

    await service.discoverCustomers({ page: 1 });

    assert.equal(requestedUrl, "https://webmais.sgp.net.br/api/ura/clientes/");
    assert.equal((requestedInit?.headers as Record<string, string>).Authorization, "Bearer secret-token");
    assert.deepEqual(JSON.parse(requestedInit?.body as string), {
      app: "siac",
      token: "secret-token",
      page: 1,
    });
  });

  it("rejects html responses with a clear exception", async () => {
    global.fetch = (async () =>
      new Response("<!DOCTYPE html><html></html>", { status: 200 })) as typeof fetch;

    const service = new SgpClientService(
      createConfig({
        SGP_API_URL: "https://webmais.sgp.net.br",
        SGP_APP: "siac",
        SGP_TOKEN: "secret-token",
      }) as never,
    );

    await assert.rejects(() => service.discoverCustomers(), HttpException);
  });
});
