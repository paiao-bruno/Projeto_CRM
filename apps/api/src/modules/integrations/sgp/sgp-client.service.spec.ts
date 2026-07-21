import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { HttpException } from "@nestjs/common";
import { SgpClientService } from "./sgp-client.service";

const credentials = {
  apiUrl: "https://webmais.sgp.net.br",
  app: "siac",
  token: "secret-token",
};

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

    const service = new SgpClientService();

    await service.discoverCustomers(credentials, { page: 1 });

    assert.equal(requestedUrl, "https://webmais.sgp.net.br/api/ura/clientes/");
    assert.equal((requestedInit?.headers as Record<string, string>).Authorization, "Bearer secret-token");
    assert.deepEqual(JSON.parse(requestedInit?.body as string), {
      app: "siac",
      token: "secret-token",
      page: 1,
    });
  });

  it("calls dedicated contract and title list endpoints", async () => {
    const requestedUrls: string[] = [];
    global.fetch = (async (url: URL | RequestInfo) => {
      requestedUrls.push(url.toString());
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const service = new SgpClientService();

    await service.discoverContracts(credentials, { offset: 0 });
    await service.discoverTitles(credentials, { offset: 0 });

    assert.deepEqual(requestedUrls, [
      "https://webmais.sgp.net.br/api/contrato/list/",
      "https://webmais.sgp.net.br/api/ura/titulos/",
    ]);
  });

  it("rejects html responses with a clear exception", async () => {
    global.fetch = (async () =>
      new Response("<!DOCTYPE html><html></html>", { status: 200 })) as typeof fetch;

    const service = new SgpClientService();

    await assert.rejects(() => service.discoverCustomers(credentials), HttpException);
  });
});
