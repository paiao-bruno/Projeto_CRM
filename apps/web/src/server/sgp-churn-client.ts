import {
  extractContractsFromClientesPayload,
  paginationFromPayload,
  redactSgpLog,
  type NormalizedSgpContract,
} from "../lib/sgp-cancellation-parse";

export const SGP_CLIENTES_ENDPOINT = "/api/ura/clientes/";
export const SGP_CLIENTES_METHOD = "POST";

export type SgpChurnCredentials = {
  apiUrl: string;
  app: string;
  token: string;
};

export class SgpReadError extends Error {
  constructor(
    message: string,
    readonly code: "auth" | "unavailable" | "timeout" | "invalid" | "loop",
  ) {
    super(message);
  }
}

function joinUrl(apiUrl: string) {
  const base = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
  return new URL(SGP_CLIENTES_ENDPOINT.replace(/^\//, ""), base).toString();
}

export function assertAllowedSgpUrl(apiUrl: string) {
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new SgpReadError("URL da API SGP inválida.", "invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SgpReadError("A URL do SGP precisa ser http(s).", "invalid");
  }
  if (url.username || url.password) {
    throw new SgpReadError("Não use usuário/senha na URL do SGP.", "invalid");
  }
  return url.origin;
}

async function postPage(
  credentials: SgpChurnCredentials,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(joinUrl(credentials.apiUrl), {
      method: SGP_CLIENTES_METHOD,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ app: credentials.app, token: credentials.token, ...payload }),
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new SgpReadError("Autenticação recusada pelo SGP (app/token).", "auth");
    }
    if (response.status === 429 || response.status === 503) {
      throw new SgpReadError(`SGP indisponível (HTTP ${response.status}).`, "unavailable");
    }
    if (!response.ok) {
      throw new SgpReadError(`SGP retornou HTTP ${response.status}.`, "unavailable");
    }
    const text = await response.text();
    if (text.trim().toLowerCase().startsWith("<!doctype") || text.trim().toLowerCase().startsWith("<html")) {
      throw new SgpReadError("O SGP devolveu HTML em vez de JSON.", "invalid");
    }
    return text ? JSON.parse(text) : {};
  } catch (error) {
    if (error instanceof SgpReadError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SgpReadError("Tempo esgotado ao consultar o SGP.", "timeout");
    }
    throw new SgpReadError("Não foi possível conectar ao SGP.", "unavailable");
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(run: () => Promise<unknown>) {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!(error instanceof SgpReadError) || (error.code !== "unavailable" && error.code !== "timeout") || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw last;
}

export async function listSgpContractsByStatus(
  credentials: SgpChurnCredentials,
  contratoStatus: number | string,
  fetchImpl: typeof fetch = fetch,
) {
  const collected: NormalizedSgpContract[] = [];
  const seenPages = new Set<string>();
  let offset = 0;
  const limit = 100;
  let pages = 0;
  const maxPages = 200;

  while (pages < maxPages) {
    const body = await withRetry(() =>
      postPage(
        credentials,
        { offset, limit, contrato_status: contratoStatus },
        fetchImpl,
      ),
    );
    const page = extractContractsFromClientesPayload(body);
    const fingerprint = page.map((row) => row.sgpContractId).sort().join(",");
    if (seenPages.has(fingerprint) && fingerprint) {
      throw new SgpReadError("Paginação do SGP repetiu a mesma página; coleta interrompida.", "loop");
    }
    if (fingerprint) seenPages.add(fingerprint);
    collected.push(...page);
    pages += 1;
    const pagination = paginationFromPayload(body);
    if (!page.length) break;
    const step = pagination.limit || limit;
    offset += step;
    if (pagination.total != null && offset >= pagination.total) break;
    if (page.length < step) break;
  }

  return { contracts: collected, pageCount: pages, logSafe: redactSgpLog({ pages, count: collected.length }) };
}
