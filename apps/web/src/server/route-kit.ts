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

/** Autentica, exige a permissão e padroniza erros (401/403/404/409/422/500). */
export function route(permission: string | null, handler: Handler, successStatus = 200) {
  return async (request: NextRequest, context: Context) => {
    try {
      const user = await requireAuth(request);
      if (permission) requirePermission(user, permission);
      const params = (await (context as Context | undefined)?.params) ?? {};
      const body = await readBody(request);
      const result = await handler({ user, request, params, query: request.nextUrl.searchParams, body });
      return jsonData(result ?? { ok: true }, successStatus);
    } catch (error) {
      return jsonError(error);
    }
  };
}
