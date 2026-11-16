import { HttpError } from "./http";

export type Body = Record<string, unknown>;

export function optionalString(body: Body, field: string, max = 500): string | undefined | null {
  if (!(field in body) || body[field] === undefined) return undefined;
  if (body[field] === null) return null;
  if (typeof body[field] !== "string") throw new HttpError(422, `${field} deve ser texto.`);
  const value = (body[field] as string).trim();
  if (value.length > max) throw new HttpError(422, `${field} deve ter no máximo ${max} caracteres.`);
  return value === "" ? null : value;
}

export function requiredString(body: Body, field: string, max = 500): string {
  const value = optionalString(body, field, max);
  if (!value) throw new HttpError(422, `${field} é obrigatório.`);
  return value;
}

export function optionalEmail(body: Body, field: string) {
  const value = optionalString(body, field, 254);
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new HttpError(422, `${field} inválido.`);
  return value;
}

export function optionalEnum<T extends string>(body: Body, field: string, allowed: readonly T[]): T | undefined {
  if (body[field] === undefined) return undefined;
  if (typeof body[field] !== "string" || !allowed.includes(body[field] as T)) {
    throw new HttpError(422, `${field} deve ser um de: ${allowed.join(", ")}.`);
  }
  return body[field] as T;
}

export function optionalDate(body: Body, field: string): Date | null | undefined {
  if (body[field] === undefined) return undefined;
  if (body[field] === null || body[field] === "") return null;
  const date = new Date(String(body[field]));
  if (Number.isNaN(date.getTime())) throw new HttpError(422, `${field} é uma data inválida.`);
  return date;
}

export function requireUuid(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(422, `${field} inválido.`);
  }
  return value;
}

export function parsePaging(query: URLSearchParams, defaultLimit = 50, maxLimit = 200) {
  const page = Math.max(1, Math.floor(Number(query.get("page"))) || 1);
  const rawLimit = Math.floor(Number(query.get("limit")));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;
  return { page, limit };
}

export function paged<T>(data: T[], total: number, page: number, limit: number) {
  return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/** Converte "129,90" / "129.90" / 129.9 em centavos sem aritmética de ponto flutuante. */
export function parseMoneyToCents(input: unknown): number {
  const text = typeof input === "number" ? String(input) : typeof input === "string" ? input.trim() : "";
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(text);
  if (!match) throw new HttpError(422, "Valor monetário inválido (use até 2 casas decimais, sem sinal).");
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) throw new HttpError(422, "Valor monetário fora do limite.");
  return cents;
}

export function amountFromBody(body: Body): number | null | undefined {
  if (body.amountCents !== undefined) {
    const value = body.amountCents;
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 99_999_999_999) {
      throw new HttpError(422, "amountCents deve ser inteiro não negativo.");
    }
    return value;
  }
  if (body.amount !== undefined) return body.amount === null ? null : parseMoneyToCents(body.amount);
  return undefined;
}

export function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
