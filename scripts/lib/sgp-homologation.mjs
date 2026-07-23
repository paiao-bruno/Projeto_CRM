const WRAPPER_KEYS = ["data", "result", "response", "results"];

const ENTITY_LIST_KEYS = {
  customers: ["clientes", "cliente", "registros", "objects", "items"],
  contracts: ["contratos", "contrato", "registros", "objects", "items"],
  invoices: ["titulos", "títulos", "titulo", "faturas", "fatura", "registros", "objects", "items"],
};

export function sanitizeText(value) {
  if (value === null || value === undefined) return value;
  return String(value).replace(/(token|senha|password|secret|app)=([^&\s]+)/gi, "$1=[REDACTED]");
}

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

export async function callSgpDirect(credentials, endpoint, payload = {}) {
  const base = credentials.apiUrl.endsWith("/") ? credentials.apiUrl : `${credentials.apiUrl}/`;
  const url = new URL(endpoint.replace(/^\//, ""), base);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), credentials.timeoutMs);

  try {
    const started = performance.now();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
    };
  } finally {
    clearTimeout(timeout);
  }
}
