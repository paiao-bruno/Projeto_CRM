import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertAllowedSgpUrl, listSgpContractsByStatus, SGP_CLIENTES_ENDPOINT, SgpReadError } from "../server/sgp-churn-client";

describe("cliente SGP de cancelamentos", () => {
  it("usa POST /api/ura/clientes/ com app/token no corpo e contrato_status=3", async () => {
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: String(init?.method), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ paginacao: { offset: 0, limit: 100, total: 0 }, clientes: [] }), { status: 200 });
    }) as typeof fetch;
    await listSgpContractsByStatus({ apiUrl: "https://webmais.example.net", app: "appx", token: "secret" }, 3, fetchImpl);
    assert.equal(calls[0].url.endsWith(SGP_CLIENTES_ENDPOINT), true);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.app, "appx");
    assert.equal(calls[0].body.token, "secret");
    assert.equal(calls[0].body.contrato_status, "3");
    assert.equal("Authorization" in calls[0], false);
  });

  it("pagina até o total e para em página repetida", async () => {
    let page = 0;
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      page += 1;
      if (page === 1) {
        assert.equal(body.offset, 0);
        return new Response(
          JSON.stringify({
            paginacao: { offset: 0, limit: 1, parcial: 1, total: 2 },
            clientes: [{ id: 1, contratos: [{ id: 10, status: 3 }] }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          paginacao: { offset: 1, limit: 1, parcial: 1, total: 2 },
          clientes: [{ id: 2, contratos: [{ id: 20, status: 3 }] }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const result = await listSgpContractsByStatus({ apiUrl: "https://webmais.example.net", app: "a", token: "t" }, 3, fetchImpl);
    assert.equal(result.contracts.length, 2);
    assert.equal(result.pageCount, 2);
  });

  it("não envia token em objeto de log", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ clientes: [] }), { status: 200 })) as typeof fetch;
    const result = await listSgpContractsByStatus({ apiUrl: "https://webmais.example.net", app: "a", token: "super-secret" }, 3, fetchImpl);
    assert.equal(JSON.stringify(result.logSafe).includes("super-secret"), false);
  });

  it("HTTP 200 com erro de token não conta como autenticado", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ erro: "Token inválido" }), { status: 200 })) as typeof fetch;
    await assert.rejects(
      () => listSgpContractsByStatus({ apiUrl: "https://webmais.example.net", app: "a", token: "t" }, 3, fetchImpl),
      (error: unknown) => error instanceof SgpReadError && error.code === "auth",
    );
  });

  it("falha de autenticação não vira zero silencioso", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await assert.rejects(
      () => listSgpContractsByStatus({ apiUrl: "https://webmais.example.net", app: "a", token: "t" }, 3, fetchImpl),
      (error: unknown) => error instanceof SgpReadError && error.code === "auth",
    );
  });

  it("não envia data_contrato_status_fim e tenta form-urlencoded se o JSON for recusado", async () => {
    const types: string[] = [];
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      types.push(String((init?.headers as Record<string, string>)["Content-Type"]));
      if (types.length === 1) {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.contrato_status, "3");
        return new Response(JSON.stringify({ erro: "[contrato_status]: deve ser uma string" }), { status: 400 });
      }
      const body = String(init?.body);
      assert.equal(body.includes("app=a"), true);
      assert.equal(body.includes("token=t"), true);
      assert.equal(body.includes("contrato_status=3"), true);
      return new Response(JSON.stringify({ clientes: [] }), { status: 200 });
    }) as typeof fetch;
    await listSgpContractsByStatus({ apiUrl: "https://webmais.example.net", app: "a", token: "t" }, 3, fetchImpl);
    assert.deepEqual(types, ["application/json", "application/x-www-form-urlencoded"]);
  });

  it("página repetida aborta em vez de loop infinito", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          paginacao: { offset: 0, limit: 1, total: 9 },
          clientes: [{ id: 1, contratos: [{ id: 10, status: 3 }] }],
        }),
        { status: 200 },
      )) as typeof fetch;
    await assert.rejects(
      () => listSgpContractsByStatus({ apiUrl: "https://webmais.example.net", app: "a", token: "t" }, 3, fetchImpl),
      (error: unknown) => error instanceof SgpReadError && error.code === "loop",
    );
  });

  it("erro no meio da paginação não devolve conjunto parcial como sucesso", async () => {
    let page = 0;
    const fetchImpl = (async () => {
      page += 1;
      if (page === 1) {
        return new Response(
          JSON.stringify({
            paginacao: { offset: 0, limit: 1, total: 2 },
            clientes: [{ id: 1, contratos: [{ id: 10, status: 3 }] }],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    await assert.rejects(
      () => listSgpContractsByStatus({ apiUrl: "https://webmais.example.net", app: "a", token: "t" }, 3, fetchImpl),
      (error: unknown) => error instanceof SgpReadError && error.code === "unavailable",
    );
  });

  it("HTTP 400 de formato não é recusa de autenticação", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ erro: "[contrato_status]: deve ser uma string de inteiros" }), { status: 400 })) as typeof fetch;
    await assert.rejects(
      () => listSgpContractsByStatus({ apiUrl: "https://webmais.example.net", app: "a", token: "t" }, 3, fetchImpl),
      (error: unknown) => error instanceof SgpReadError && error.code === "invalid",
    );
  });

  it("rejeita URL com credenciais embutidas", () => {
    assert.throws(() => assertAllowedSgpUrl("https://user:pass@sgp.example"), /usuário\/senha/);
  });
});
