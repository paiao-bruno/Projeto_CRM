import { NextRequest } from "next/server";
import { requireAuth, requirePermission, type ServerAuthUser } from "./auth";
import { HttpError, jsonData, jsonError } from "./http";

export type RouteArgs = {
  user: ServerAuthUser;
  request: NextRequest;
  params: Record<string, string | string[]>;
  query: URLSearchParams;
  body: Record<string, unknown>;
};

type Handler = (args: RouteArgs) => Promise<unknown>;
type Context = { params: Promise<Record<string, string | string[]>> };

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  if (request.method === "GET" || request.method === "DELETE") return {};
  try {
    const text = await request.text();
    if (text.trim() === "") return {};
    const json = JSON.parse(text);
    return json && typeof json === "object" && !Array.isArray(json) ? json : {};
  } catch {
    throw new HttpError(400, "Corpo da requisição inválido (JSON esperado).");
  }
}

function respond(result: unknown, status: number) {
  return result instanceof Response ? result : jsonData(result ?? { ok: true }, status);
}

/** Autentica, exige a permissão e padroniza erros (401/403/404/409/422/500). */
export function route(permission: string | null, handler: Handler, successStatus = 200) {
  return async (request: NextRequest, context: Context) => {
    try {
      const user = await requireAuth(request);
      if (permission) requirePermission(user, permission);
      const params = (await (context as Context | undefined)?.params) ?? {};
      const body = await readBody(request);
      return respond(await handler({ user, request, params, query: request.nextUrl.searchParams, body }), successStatus);
    } catch (error) {
      return jsonError(error);
    }
  };
}

type PublicHandler = (args: { request: NextRequest; query: URLSearchParams; body: Record<string, unknown> }) => Promise<unknown>;

/** Rota sem sessão (login, recuperação de acesso). Mesmo padrão de erros. */
export function publicRoute(handler: PublicHandler, successStatus = 200) {
  return async (request: NextRequest) => {
    try {
      const body = await readBody(request);
      return respond(await handler({ request, query: request.nextUrl.searchParams, body }), successStatus);
    } catch (error) {
      return jsonError(error);
    }
  };
}

export type RouteDef = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Ex.: "members/:id/reset-link". Parâmetros ":nome" chegam em `params`. */
  path: string;
  permission: string | null;
  handler: Handler;
  status?: number;
};

function matchPath(pattern: string[], actual: string[]) {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i].startsWith(":")) params[pattern[i].slice(1)] = actual[i];
    else if (pattern[i] !== actual[i]) return null;
  }
  return params;
}

/** Tabela de rotas para um módulo inteiro em um único arquivo `[...path]/route.ts`. */
export function router(defs: RouteDef[]) {
  const compiled = defs.map((def) => ({ ...def, segments: def.path.split("/").filter(Boolean) }));
  const handle = (method: RouteDef["method"]) => async (request: NextRequest, context: { params: Promise<Record<string, string | string[]>> }) => {
    try {
      const { path = [] } = (await context.params) as { path?: string[] };
      let matched: { def: (typeof compiled)[number]; params: Record<string, string> } | null = null;
      for (const def of compiled) {
        if (def.method !== method) continue;
        const params = matchPath(def.segments, path);
        if (params) { matched = { def, params }; break; }
      }
      if (!matched) throw new HttpError(404, "Rota nao encontrada.");
      const user = await requireAuth(request);
      if (matched.def.permission) requirePermission(user, matched.def.permission);
      const body = method === "GET" || method === "DELETE" ? {} : await readBody(request);
      const result = await matched.def.handler({ user, request, params: matched.params, query: request.nextUrl.searchParams, body });
      return respond(result, matched.def.status ?? 200);
    } catch (error) {
      return jsonError(error);
    }
  };
  return { GET: handle("GET"), POST: handle("POST"), PATCH: handle("PATCH"), PUT: handle("PUT"), DELETE: handle("DELETE") };
}
