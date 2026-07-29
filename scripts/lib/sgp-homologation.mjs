const WRAPPER_KEYS = ["data", "result", "response", "results"];

const ENTITY_LIST_KEYS = {
  customers: ["clientes", "cliente", "registros", "objects", "items"],
  contracts: ["contratos", "contrato", "registros", "objects", "items"],
  invoices: ["titulos", "títulos", "titulo", "faturas", "fatura", "registros", "objects", "items"],
};

export const DEFAULT_SGP_DIRECT_ENDPOINTS = [
  {
    id: "sgp-customers",
    entity: "customers",
    path: "/api/ura/clientes/",
    method: "POST",
    envVar: "SGP_DIRECT_CUSTOMERS_PATH",
    methodEnvVar: "SGP_DIRECT_CUSTOMERS_METHOD",
    directProbeOnly: false,
  },
  {
    id: "sgp-contracts",
    entity: "contracts",
    path: "/api/contrato/list/",
    method: "POST",
    envVar: "SGP_DIRECT_CONTRACTS_PATH",
    methodEnvVar: "SGP_DIRECT_CONTRACTS_METHOD",
    directProbeOnly: true,
    syncUsesDedicatedApi: true,
    syncNote:
      "A sync CRM usa POST /api/contrato/list/ via SgpClientService.discoverContracts; este teste direto é sonda opcional.",
  },
  {
    id: "sgp-invoices",
    entity: "invoices",
    path: "/api/ura/titulos/",
    method: "POST",
    envVar: "SGP_DIRECT_INVOICES_PATH",
    methodEnvVar: "SGP_DIRECT_INVOICES_METHOD",
    directProbeOnly: false,
  },
];

export function sanitizeText(value) {
  if (value === null || value === undefined) return value;
  return String(value).replace(/(token|senha|password|secret|app)=([^&\s]+)/gi, "$1=[REDACTED]");
}

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeSgpApiUrl(url) {
  if (!url) return "";
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed.endsWith("/") ? trimmed : `${trimmed}/`);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathname}`.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

export function redactSgpRequestUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return sanitizeText(url);
  }
}

export function parseRetryAfterMs(retryAfterHeader, fallbackMs = 1000) {
  if (!retryAfterHeader) return fallbackMs;
  const numeric = Number.parseInt(String(retryAfterHeader), 10);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric * 1000;
  }
  const dateMs = Date.parse(String(retryAfterHeader));
  if (Number.isFinite(dateMs)) {
    return Math.max(dateMs - Date.now(), 0);
  }
  return fallbackMs;
}

export function computeRetryDelayMs(attempt, retryAfterMs, baseDelayMs = 1000) {
  if (retryAfterMs !== null && retryAfterMs !== undefined) {
    return Math.max(retryAfterMs, 0);
  }
  return baseDelayMs * 2 ** Math.max(attempt - 1, 0);
}

export function detectEntityPaths(body, entity) {
  const listKeys = ENTITY_LIST_KEYS[entity];
  const paths = [];

  function walk(node, prefix, depth) {
    if (depth > 6 || node === null || node === undefined) return;

    if (Array.isArray(node)) {
      if (node.length > 0) paths.push(`${prefix}[] (${node.length})`);
      return;
    }

    if (!isRecord(node)) return;

    for (const key of listKeys) {
      const value = node[key];
      if (Array.isArray(value) && value.length > 0) {
        paths.push(`${prefix}.${key}[] (${value.length})`);
      }
    }

    for (const key of WRAPPER_KEYS) {
      if (key in node) {
        walk(node[key], `${prefix}.${key}`, depth + 1);
      }
    }
  }

  walk(body, "root", 0);
  return paths;
}

export function summarizeSgpBody(body) {
  if (!isRecord(body) && !Array.isArray(body)) {
    return { type: typeof body, topLevelKeys: [], arrayKeys: {}, detectedPaths: {} };
  }

  const topLevelKeys = isRecord(body) ? Object.keys(body).slice(0, 20) : [];
  const arrayKeys = isRecord(body)
    ? Object.fromEntries(
        Object.keys(body)
          .filter((key) => Array.isArray(body[key]))
          .map((key) => [key, body[key].length]),
      )
    : Array.isArray(body)
      ? { root: body.length }
      : {};

  return {
    type: Array.isArray(body) ? "array" : "object",
    topLevelKeys,
    arrayKeys,
    detectedPaths: {
      customers: detectEntityPaths(body, "customers"),
      contracts: detectEntityPaths(body, "contracts"),
      invoices: detectEntityPaths(body, "invoices"),
    },
  };
}

export function createStepRunner(report) {
  return {
    pass(step, detail = {}, extra = {}) {
      report.steps.push({
        id: step,
        status: "PASS",
        detail,
        ...extra,
      });
    },
    fail(step, message, extra = {}) {
      report.steps.push({
        id: step,
        status: "FAIL",
        message: sanitizeText(message),
        ...extra,
      });
      report.issues.push({ step, message: sanitizeText(message) });
    },
    partial(step, message, extra = {}) {
      report.steps.push({
        id: step,
        status: "PARTIAL",
        message: sanitizeText(message),
        ...extra,
      });
    },
    skip(step, reason, extra = {}) {
      report.steps.push({
        id: step,
        status: "SKIPPED",
        reason: sanitizeText(reason),
        ...extra,
      });
    },
  };
}

export function resolveHomologationCredentials(env = process.env) {
  return {
    apiUrl: env.SGP_API_URL?.trim(),
    app: env.SGP_APP?.trim(),
    token: env.SGP_TOKEN?.trim(),
    timeoutMs: Number(env.SGP_TIMEOUT_MS ?? 15_000),
    adminEmail: (env.BOOTSTRAP_ADMIN_EMAIL ?? env.ADMIN_EMAIL ?? "").trim().toLowerCase(),
    adminPassword: env.BOOTSTRAP_ADMIN_PASSWORD ?? env.ADMIN_PASSWORD ?? "",
  };
}

export function validateHomologationCredentials(credentials) {
  const missing = [];
  if (!credentials.apiUrl) missing.push("SGP_API_URL");
  if (!credentials.app) missing.push("SGP_APP");
  if (!credentials.token) missing.push("SGP_TOKEN");
  if (!credentials.adminEmail) missing.push("BOOTSTRAP_ADMIN_EMAIL ou ADMIN_EMAIL");
  if (!credentials.adminPassword) missing.push("BOOTSTRAP_ADMIN_PASSWORD ou ADMIN_PASSWORD");
  return missing;
}

export function findExistingCredential(credentialsList, apiUrl) {
  if (!Array.isArray(credentialsList)) return null;
  const normalizedTarget = normalizeSgpApiUrl(apiUrl);
  return (
    credentialsList.find((item) => normalizeSgpApiUrl(item.apiUrl) === normalizedTarget) ?? null
  );
}

export function classifyDirectSgpProbeResult(endpointDef, result) {
  const request = {
    method: endpointDef.method ?? "POST",
    url: redactSgpRequestUrl(result.requestUrl ?? endpointDef.path),
    status: result.status,
  };

  if (result.ok) {
    return { classification: "pass", request, blocksProduction: false };
  }

  if (result.status === 405 && endpointDef.directProbeOnly) {
    return {
      classification: "direct-probe-method-not-allowed",
      request,
      blocksProduction: false,
      note:
        endpointDef.syncNote ??
        "HTTP 405 na sonda direta não bloqueia a sync CRM se o fluxo interno estiver validado.",
    };
  }

  if (result.status === 429) {
    return {
      classification: result.rateLimitExhausted ? "rate-limit-exhausted" : "rate-limit",
      request,
      blocksProduction: Boolean(result.rateLimitExhausted),
      note: result.rateLimitDiagnostic ?? "Rate limit SGP.",
    };
  }

  return {
    classification: "fail",
    request,
    blocksProduction: !endpointDef.directProbeOnly,
  };
}

export async function callSgpDirect(credentials, endpoint, payload = {}, options = {}) {
  const method = (options.method ?? "POST").toUpperCase();
  const base = credentials.apiUrl.endsWith("/") ? credentials.apiUrl : `${credentials.apiUrl}/`;
  const url = new URL(endpoint.replace(/^\//, ""), base);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), credentials.timeoutMs);

  try {
    const started = performance.now();
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify({
        app: credentials.app,
        token: credentials.token,
        ...payload,
      }),
      signal: controller.signal,
    });
    const durationMs = Math.round(performance.now() - started);
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    return {
      ok: response.ok,
      status: response.status,
      durationMs,
      body,
      structure: summarizeSgpBody(body),
      requestUrl: url.toString(),
      requestMethod: method,
      retryAfter: response.headers.get("retry-after"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function callSgpDirectWithRetry(credentials, endpoint, payload = {}, options = {}) {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const method = options.method ?? "POST";
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await callSgpDirect(credentials, endpoint, payload, { method });
    if (lastResult.status !== 429) {
      return { ...lastResult, attempts: attempt };
    }

    if (attempt >= maxAttempts) {
      return {
        ...lastResult,
        attempts: attempt,
        rateLimitExhausted: true,
        rateLimitDiagnostic: `HTTP 429 após ${attempt} tentativa(s) em ${endpoint} (${method}).`,
      };
    }

    const delayMs = computeRetryDelayMs(
      attempt,
      parseRetryAfterMs(lastResult.retryAfter, baseDelayMs),
      baseDelayMs,
    );
    await sleep(delayMs);
  }

  return lastResult;
}

export async function fetchPaginatedWithRetry(fetchPage, options = {}) {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const pageDelayMs = options.pageDelayMs ?? 150;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pages = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    let attempt = 0;
    let response = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      response = await fetchPage(page);
      if (response.status !== 429) break;
      if (attempt >= maxAttempts) {
        throw new Error(
          `HTTP 429 na paginação (página ${page}) após ${attempt} tentativa(s). Retry-After=${response.retryAfter ?? "(ausente)"}`,
        );
      }
      const delayMs = computeRetryDelayMs(
        attempt,
        parseRetryAfterMs(response.retryAfter, baseDelayMs),
        baseDelayMs,
      );
      await sleep(delayMs);
    }

    if (!response?.ok) {
      throw new Error(`Paginação falhou na página ${page}: HTTP ${response?.status ?? "unknown"}`);
    }

    totalPages = response.body?.totalPages ?? 1;
    pages.push({
      page,
      durationMs: response.durationMs,
      total: response.body?.total,
      dataLength: response.body?.data?.length ?? 0,
      attempts: attempt,
    });
    page += 1;
    if (page <= totalPages) {
      await sleep(pageDelayMs);
    }
  }

  return pages;
}
