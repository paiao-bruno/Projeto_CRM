export type SgpEntityKind = "customer" | "contract" | "invoice";

const WRAPPER_KEYS = ["data", "result", "response", "results"] as const;

const PAGINATION_KEYS = new Set([
  "offset",
  "limit",
  "total",
  "page",
  "pagina",
  "parcial",
  "partial",
  "count",
  "next",
  "pages",
  "total_pages",
  "paginas",
  "per_page",
  "por_pagina",
  "status",
  "message",
  "success",
  "msg",
  "erro",
  "error",
]);

const LIST_KEYS: Record<SgpEntityKind, string[]> = {
  customer: ["clientes", "cliente", "registros", "objects", "items"],
  contract: ["contratos", "contrato", "registros", "objects", "items"],
  invoice: ["titulos", "títulos", "titulo", "faturas", "fatura", "registros", "objects", "items"],
};

const ENTITY_ID_KEYS: Record<SgpEntityKind, string[]> = {
  customer: ["id", "cliente_id", "idcliente", "codigo", "codcli", "cod_cliente"],
  contract: ["id", "contrato", "idcontrato", "contrato_id", "id_contrato", "numero", "codigo"],
  invoice: [
    "id",
    "titulo",
    "idtitulo",
    "titulo_id",
    "id_titulo",
    "numero_documento",
    "documento",
    "nosso_numero",
  ],
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

export function looksLikeCustomer(record: Record<string, unknown>) {
  return Boolean(
    firstString(record, ["cpfcnpj", "cpf_cnpj", "cpf", "cnpj", "documento", "document"]) ||
      firstString(record, ["nome", "razao_social", "razaosocial", "nomecliente", "cliente", "name"]) ||
      firstString(record, ENTITY_ID_KEYS.customer),
  );
}

export function looksLikeContract(record: Record<string, unknown>) {
  return Boolean(
    firstString(record, ENTITY_ID_KEYS.contract) ||
      firstString(record, ["plano", "plano_nome", "nome_plano", "login", "pppoe"]),
  );
}

export function looksLikeTitle(record: Record<string, unknown>) {
  return Boolean(
    firstString(record, ENTITY_ID_KEYS.invoice) ||
      firstString(record, ["valor", "valor_total", "vencimento", "data_vencimento"]),
  );
}

function isEntityRecord(kind: SgpEntityKind, record: Record<string, unknown>) {
  if (isPaginationOnlyRecord(record)) {
    return false;
  }

  switch (kind) {
    case "customer":
      return looksLikeCustomer(record);
    case "contract":
      return looksLikeContract(record);
    case "invoice":
      return looksLikeTitle(record);
    default:
      return false;
  }
}

function isPaginationOnlyRecord(record: Record<string, unknown>) {
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return true;
  }

  return keys.every((key) => PAGINATION_KEYS.has(key.toLowerCase()));
}

function dedupeRecords(records: Array<Record<string, unknown>>, kind: SgpEntityKind) {
  const seen = new Set<string>();
  const deduped: Array<Record<string, unknown>> = [];

  for (const record of records) {
    const identity =
      firstString(record, ENTITY_ID_KEYS[kind]) ??
      JSON.stringify(Object.keys(record).sort().map((key) => [key, record[key]]));
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    deduped.push(record);
  }

  return deduped;
}

export function extractSgpEntityRecords(
  body: unknown,
  kind: SgpEntityKind,
  depth = 0,
  maxDepth = 6,
  visited: WeakSet<object> = new WeakSet(),
): Array<Record<string, unknown>> {
  if (body === null || body === undefined) {
    return [];
  }

  if (depth > maxDepth) {
    return [];
  }

  if (Array.isArray(body)) {
    const records = body
      .filter(isRecord)
      .flatMap((item) => {
        if (isEntityRecord(kind, item)) {
          return [item];
        }
        return extractSgpEntityRecords(item, kind, depth + 1, maxDepth, visited);
      });

    return dedupeRecords(records, kind);
  }

  if (!isRecord(body)) {
    return [];
  }

  if (visited.has(body)) {
    return [];
  }
  visited.add(body);

  const listKeys = LIST_KEYS[kind];

  for (const key of listKeys) {
    const value = body[key];
    if (Array.isArray(value)) {
      const records = value.filter(isRecord).filter((item) => isEntityRecord(kind, item));
      if (records.length > 0) {
        return dedupeRecords(records, kind);
      }
    }
  }

  for (const key of WRAPPER_KEYS) {
    const value = body[key];
    if (value === null || value === undefined) {
      continue;
    }

    const nested = extractSgpEntityRecords(value, kind, depth + 1, maxDepth, visited);
    if (nested.length > 0) {
      return nested;
    }
  }

  for (const key of listKeys) {
    const value = body[key];
    if (isRecord(value)) {
      const nested = extractSgpEntityRecords(value, kind, depth + 1, maxDepth, visited);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  if (isEntityRecord(kind, body)) {
    return [body];
  }

  return [];
}

export function summarizeSgpResponseStructure(body: unknown) {
  if (body === null || body === undefined) {
    return { type: "empty", topLevelKeys: [], arrayKeys: {}, detectedPaths: [] };
  }

  if (Array.isArray(body)) {
    return {
      type: "array",
      topLevelKeys: [],
      arrayKeys: { root: body.length },
      detectedPaths: ["root[]"],
    };
  }

  if (!isRecord(body)) {
    return { type: typeof body, topLevelKeys: [], arrayKeys: {}, detectedPaths: [] };
  }

  const topLevelKeys = Object.keys(body);
  const arrayKeys = Object.fromEntries(
    topLevelKeys
      .filter((key) => Array.isArray(body[key]))
      .map((key) => [key, (body[key] as unknown[]).length]),
  );

  const detectedPaths: string[] = [];
  for (const kind of ["customer", "contract", "invoice"] as const) {
    const records = extractSgpEntityRecords(body, kind);
    if (records.length > 0) {
      detectedPaths.push(`${kind}:${records.length}`);
    }
  }

  return {
    type: "object",
    topLevelKeys: topLevelKeys.slice(0, 20),
    arrayKeys,
    detectedPaths,
  };
}

export function bodyMayContainEntityPayload(body: unknown, kind: SgpEntityKind) {
  if (body === null || body === undefined) {
    return false;
  }

  if (Array.isArray(body)) {
    return body.length > 0;
  }

  if (!isRecord(body)) {
    return false;
  }

  const listKeys = LIST_KEYS[kind];
  for (const key of [...listKeys, ...WRAPPER_KEYS]) {
    const value = body[key];
    if (Array.isArray(value) && value.length > 0) {
      return true;
    }
    if (isRecord(value) && bodyMayContainEntityPayload(value, kind)) {
      return true;
    }
  }

  return false;
}
