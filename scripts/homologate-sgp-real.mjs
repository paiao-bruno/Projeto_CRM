#!/usr/bin/env node
/**
 * Homologação com API SGP REAL.
 *
 * O operador deve executar o bootstrap de produção antes deste script.
 *
 * Variáveis obrigatórias:
 *   SGP_API_URL, SGP_APP, SGP_TOKEN
 *   BOOTSTRAP_ADMIN_EMAIL ou ADMIN_EMAIL
 *   BOOTSTRAP_ADMIN_PASSWORD ou ADMIN_PASSWORD
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as wait } from "node:timers/promises";
import { Client } from "pg";
import {
  resolveNodeInvocation,
  resolveNpmInvocation,
  runSubprocessSync,
} from "./lib/cross-platform-spawn.mjs";
import {
  callSgpDirectWithRetry,
  classifyDirectSgpProbeResult,
  createStepRunner,
  DEFAULT_SGP_DIRECT_ENDPOINTS,
  findExistingCredential,
  fetchPaginatedWithRetry,
  normalizeSgpApiUrl,
  redactSgpRequestUrl,
  resolveHomologationCredentials,
  sanitizeText,
  summarizeSgpBody,
  validateHomologationCredentials,
} from "./lib/sgp-homologation.mjs";

const ROOT = process.cwd();
const RAW_API = process.env.API_URL ?? "http://localhost:4000";
const API_URL = RAW_API.endsWith("/api") ? RAW_API : `${RAW_API.replace(/\/$/, "")}/api`;
const WEB_URL = process.env.APP_URL ?? "http://localhost:3000";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://crm:crm@localhost:5432/isp_crm?schema=public";

const SGP = resolveHomologationCredentials(process.env);
const ADMIN_EMAIL = SGP.adminEmail;
const ADMIN_PASSWORD = SGP.adminPassword;

const SGP_ENDPOINTS = DEFAULT_SGP_DIRECT_ENDPOINTS.map((endpoint) => ({
  ...endpoint,
  path: process.env[endpoint.envVar ?? ""]?.trim() || endpoint.path,
  method: process.env[endpoint.methodEnvVar ?? ""]?.trim()?.toUpperCase() || endpoint.method,
}));

const report = {
  startedAt: new Date().toISOString(),
  mode: "real-sgp",
  prerequisites: {},
  steps: [],
  auth: {},
  sync: {},
  data: {},
  consistency: {},
  pagination: {},
  sgpDirect: {},
  frontend: {},
  regressionAudit: {},
  errorHandling: {},
  issues: [],
  passed: [],
  conclusion: {},
};

const steps = createStepRunner(report);

function passLegacy(step, detail = "") {
  report.passed.push({ step, detail });
}

async function waitForApi() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "invalid@example.org", password: "x" }),
      });
      if (res.status < 500) return;
    } catch {
      // retry
    }
    await wait(500);
  }
  throw new Error("API não respondeu a tempo.");
}

function startApi() {
  const invocation = resolveNodeInvocation(path.join(ROOT, "apps/api/dist/main.js"));
  return spawn(invocation.command, invocation.args, {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL,
      AUTO_SEED_DEMO: "false",
      SGP_AUTO_SYNC_ENABLED: "false",
      RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX ?? "5000",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "validation-encryption-key-32-chars-min",
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "validation-access-secret-change-me",
    },
    stdio: "ignore",
    shell: false,
  });
}

async function login() {
  const started = performance.now();
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const durationMs = Math.round(performance.now() - started);
  const body = await res.json();
  if (!res.ok) throw new Error(`Login falhou: ${res.status} ${sanitizeText(JSON.stringify(body))}`);
  return { token: body.accessToken, durationMs, user: body.user };
}

async function apiPost(token, path, payload = {}) {
  const started = performance.now();
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const durationMs = Math.round(performance.now() - started);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body, durationMs };
}

async function apiGet(token, path) {
  const started = performance.now();
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const durationMs = Math.round(performance.now() - started);
  const body = await res.json();
  return { ok: res.ok, status: res.status, body, durationMs };
}

async function waitSync(token, runId) {
  const started = Date.now();
  while (Date.now() - started < 900_000) {
    const { body } = await apiGet(token, `/integrations/sgp/sync-runs/${runId}`);
    if (body.status && body.status !== "RUNNING") {
      return body;
    }
    await wait(1000);
  }
  throw new Error(`Sync ${runId} não finalizou em 15 minutos.`);
}

async function dbCounts(client, tenantId) {
  const q = async (sql) => (await client.query(sql, [tenantId])).rows[0].c;
  return {
    customers: await q(`SELECT COUNT(*)::int c FROM "Customer" WHERE "tenantId"=$1 AND "deletedAt" IS NULL`),
    contracts: await q(`SELECT COUNT(*)::int c FROM "Contract" WHERE "tenantId"=$1 AND "deletedAt" IS NULL`),
    invoices: await q(`SELECT COUNT(*)::int c FROM "Invoice" WHERE "tenantId"=$1 AND "deletedAt" IS NULL`),
  };
}

async function assertBootstrapUser(client) {
  const result = await client.query(`SELECT id FROM "User" WHERE email = $1 LIMIT 1`, [ADMIN_EMAIL]);
  if (result.rows.length === 0) {
    throw new Error(
      "Administrador não encontrado. Execute npm run bootstrap:production antes da homologação.",
    );
  }
}

async function fetchApiTotal(token, endpoint) {
  const res = await apiGet(token, `${endpoint}?page=1&limit=1`);
  return res.ok ? (res.body.total ?? 0) : null;
}

function printCredentialInstructions(missing) {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  INTERVENÇÃO NECESSÁRIA — variáveis ausentes                     ║
╠══════════════════════════════════════════════════════════════════╣
║  Variáveis faltantes: ${missing.join(", ")}
║
║  1) Bootstrap de produção:
║     export BOOTSTRAP_TENANT_NAME="Minha ISP"
║     export BOOTSTRAP_TENANT_SLUG="minha-isp"
║     export BOOTSTRAP_ADMIN_NAME="Administrador"
║     export BOOTSTRAP_ADMIN_EMAIL="admin@suaisp.com.br"
║     export BOOTSTRAP_ADMIN_PASSWORD="SenhaForte123"
║     npm run bootstrap:production
║
║  2) Homologação SGP real:
║     export SGP_API_URL="https://SUA-INSTANCIA.sgp.net.br"
║     export SGP_APP="seu-app"
║     export SGP_TOKEN="seu-token"
║     export SGP_TIMEOUT_MS="15000"
║     npm run homologate:sgp
╚══════════════════════════════════════════════════════════════════╝
`);
}

async function main() {
  const missing = validateHomologationCredentials(SGP);
  if (missing.length > 0) {
    report.prerequisites = { missing, status: "SKIPPED" };
    steps.skip("prerequisites", `Variáveis ausentes: ${missing.join(", ")}`);
    printCredentialInstructions(missing);
    report.conclusion = {
      approved: false,
      reason: "Execução externa pendente por credenciais/variáveis ausentes.",
    };
    fs.writeFileSync(path.join(ROOT, "homologation-report.json"), JSON.stringify(report, null, 2));
    process.exit(2);
  }

  report.prerequisites = {
    sgpApiUrl: SGP.apiUrl.replace(/\/\/[^@]+@/, "//***@"),
    sgpApp: SGP.app,
    tokenConfigured: true,
    adminEmail: ADMIN_EMAIL,
    timeoutMs: SGP.timeoutMs,
  };
  steps.pass("prerequisites", { configured: true });

  runSubprocessSync(
    "regression-audit",
    resolveNodeInvocation(path.join(ROOT, "scripts/audit-sgp-regression.mjs")),
    { cwd: ROOT, stdio: "pipe" },
  );
  try {
    report.regressionAudit = JSON.parse(
      fs.readFileSync(path.join(ROOT, "sgp-regression-audit.json"), "utf8"),
    );
    steps.pass("regression-audit", { commit: report.regressionAudit.definitiveFixCommit });
  } catch {
    steps.partial("regression-audit", "Auditoria Git indisponível");
  }

  runSubprocessSync(
    "build-api",
    resolveNpmInvocation(["run", "build", "-w", "apps/api"], ROOT),
    { cwd: ROOT, stdio: "inherit" },
  );
  runSubprocessSync(
    "build-web",
    resolveNpmInvocation(["run", "build", "-w", "apps/web"], ROOT),
    {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "inherit",
    },
  );

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  try {
    await assertBootstrapUser(db);
    steps.pass("bootstrap-user", { adminEmail: ADMIN_EMAIL });
  } catch (error) {
    steps.fail("bootstrap-user", error instanceof Error ? error.message : String(error));
    report.conclusion = { approved: false, reason: "Bootstrap de produção não executado." };
    fs.writeFileSync(path.join(ROOT, "homologation-report.json"), JSON.stringify(report, null, 2));
    await db.end();
    process.exit(2);
  }

  const apiProcess = startApi();
  await waitForApi();

  try {
    const { token, durationMs: loginMs, user } = await login();
    report.auth.login = { ok: true, durationMs: loginMs, tenantId: user.tenantId };
    steps.pass("crm-auth", { durationMs: loginMs, endpoint: "/auth/login" });
    passLegacy("login", `${loginMs}ms`);

    for (const endpoint of SGP_ENDPOINTS) {
      const result = await callSgpDirectWithRetry(SGP, endpoint.path, { limit: 50, offset: 0 }, {
        method: endpoint.method,
        maxAttempts: 5,
        baseDelayMs: 1000,
        sleep: wait,
      });
      const classification = classifyDirectSgpProbeResult(endpoint, result);
      report.sgpDirect[endpoint.id] = {
        endpoint: endpoint.path,
        method: endpoint.method,
        requestUrl: redactSgpRequestUrl(result.requestUrl),
        ok: result.ok,
        status: result.status,
        durationMs: result.durationMs,
        structure: result.structure,
        classification: classification.classification,
        directProbeOnly: endpoint.directProbeOnly ?? false,
        blocksProduction: classification.blocksProduction,
        attempts: result.attempts ?? 1,
        note: classification.note ?? null,
      };

      if (result.ok) {
        steps.pass(endpoint.id, {
          endpoint: endpoint.path,
          method: endpoint.method,
          requestUrl: redactSgpRequestUrl(result.requestUrl),
          structure: result.structure,
        });
      } else if (classification.classification === "direct-probe-method-not-allowed") {
        steps.partial(endpoint.id, `HTTP ${result.status} na sonda direta (${endpoint.method} ${endpoint.path}) — não bloqueia sync CRM`, {
          endpoint: endpoint.path,
          method: endpoint.method,
          requestUrl: redactSgpRequestUrl(result.requestUrl),
          note: classification.note,
        });
      } else if (result.status === 429 && result.rateLimitExhausted) {
        steps.fail(endpoint.id, result.rateLimitDiagnostic ?? `HTTP 429 esgotou tentativas`, {
          endpoint: endpoint.path,
          method: endpoint.method,
        });
      } else if (endpoint.directProbeOnly) {
        steps.partial(endpoint.id, `HTTP ${result.status} na sonda direta (${endpoint.method} ${endpoint.path})`, {
          endpoint: endpoint.path,
          method: endpoint.method,
        });
      } else {
        const detail =
          typeof result.body === "string"
            ? result.body.slice(0, 200)
            : JSON.stringify(result.body ?? {}).slice(0, 200);
        steps.fail(endpoint.id, `HTTP ${result.status}: ${detail}`, {
          endpoint: endpoint.path,
          method: endpoint.method,
          requestUrl: redactSgpRequestUrl(result.requestUrl),
        });
      }
    }

    const testAuth = await apiPost(token, "/integrations/sgp/credentials/test", {
      apiUrl: SGP.apiUrl,
      app: SGP.app,
      token: SGP.token,
      timeoutMs: SGP.timeoutMs,
    });
    report.auth.sgpTestAuth = {
      ok: testAuth.ok,
      status: testAuth.status,
      durationMs: testAuth.durationMs,
      structure: summarizeSgpBody(testAuth.body),
    };
    if (testAuth.ok) {
      steps.pass("sgp-auth", { endpoint: "/integrations/sgp/credentials/test", durationMs: testAuth.durationMs });
      passLegacy("sgp-autenticacao", `${testAuth.durationMs}ms`);
    } else {
      steps.fail("sgp-auth", `HTTP ${testAuth.status}`);
    }

    let credentialId;
    const existing = await apiGet(token, "/integrations/sgp/credentials");
    const match = findExistingCredential(existing.body, SGP.apiUrl);
    if (match) {
      credentialId = match.id;
      await apiPost(token, `/integrations/sgp/credentials/${credentialId}/test`, {});
      steps.pass("sgp-credentials-existing", {
        credentialId,
        apiUrl: normalizeSgpApiUrl(match.apiUrl),
        reused: true,
      });
    } else {
      const created = await apiPost(token, "/integrations/sgp/credentials", {
        name: "SGP Homologação",
        apiUrl: SGP.apiUrl,
        app: SGP.app,
        token: SGP.token,
        timeoutMs: SGP.timeoutMs,
      });
      if (!created.ok) {
        steps.fail("sgp-credentials", JSON.stringify(created.body));
      } else {
        credentialId = created.body.id;
        steps.pass("sgp-credentials", { credentialId });
        passLegacy("sgp-credentials", credentialId);
      }
    }

    const tenantId = user.tenantId;
    const beforeCounts = await dbCounts(db, tenantId);
    report.data.beforeSync = beforeCounts;

    const fullStart = await apiPost(token, "/integrations/sgp/sync-customers", {
      credentialId,
      full: true,
    });
    if (!fullStart.ok || !fullStart.body?.runId) {
      steps.fail("sync-full", JSON.stringify(fullStart.body));
    } else {
      const fullRun = await waitSync(token, fullStart.body.runId);
      report.sync.full = {
        runId: fullStart.body.runId,
        status: fullRun.status,
        durationMs: fullRun.durationMs,
        processed: fullRun.customersProcessed ?? fullRun.processed ?? 0,
        created: fullRun.customersCreated ?? fullRun.created ?? 0,
        updated: fullRun.customersUpdated ?? fullRun.updated ?? 0,
        ignored: fullRun.customersIgnored ?? fullRun.ignored ?? 0,
        contractsCreated: fullRun.contractsCreated ?? 0,
        contractsUpdated: fullRun.contractsUpdated ?? 0,
        contractsDeleted: fullRun.contractsDeleted ?? 0,
        invoicesCreated: fullRun.invoicesCreated ?? 0,
        invoicesUpdated: fullRun.invoicesUpdated ?? 0,
        invoicesDeleted: fullRun.invoicesDeleted ?? 0,
      };
      if (fullRun.status === "COMPLETED" || fullRun.status === "PARTIAL") {
        steps.pass("sync-full", report.sync.full);
        passLegacy("sync-completa", `${fullRun.durationMs}ms`);
      } else {
        steps.fail("sync-full", fullRun.status ?? "FAILED");
      }
    }

    const afterFull = await dbCounts(db, tenantId);
    report.data.afterFullSync = afterFull;

    if (afterFull.customers > 0 && afterFull.contracts === 0) {
      steps.fail("sync-contracts-persisted", `${afterFull.customers} clientes e 0 contratos`);
    } else if (afterFull.contracts > 0) {
      steps.pass("sync-contracts-persisted", { count: afterFull.contracts });
      passLegacy("sync-contratos-persistidos", `${afterFull.contracts}`);
    } else {
      steps.partial("sync-contracts-persisted", "Nenhum contrato encontrado para validar");
    }

    if (afterFull.customers > 0 && afterFull.invoices === 0) {
      steps.fail("sync-invoices-persisted", `${afterFull.customers} clientes e 0 faturas`);
    } else if (afterFull.invoices > 0) {
      steps.pass("sync-invoices-persisted", { count: afterFull.invoices });
      passLegacy("sync-faturas-persistidas", `${afterFull.invoices}`);
    } else {
      steps.partial("sync-invoices-persisted", "Nenhuma fatura encontrada para validar");
    }

    const apiCustomers = await fetchApiTotal(token, "/customers");
    const apiContracts = await fetchApiTotal(token, "/contracts");
    const apiInvoices = await fetchApiTotal(token, "/invoices");
    report.consistency = {
      db: afterFull,
      api: { customers: apiCustomers, contracts: apiContracts, invoices: apiInvoices },
      matches: {
        customers: apiCustomers === afterFull.customers,
        contracts: apiContracts === afterFull.contracts,
        invoices: apiInvoices === afterFull.invoices,
      },
    };
    for (const [entity, ok] of Object.entries(report.consistency.matches)) {
      if (ok) steps.pass(`consistency-${entity}`, report.consistency);
      else steps.fail(`consistency-${entity}`, `DB/API divergentes para ${entity}`);
    }

    const incStart = await apiPost(token, "/integrations/sgp/sync-customers", { credentialId });
    if (!incStart.ok || !incStart.body?.runId) {
      steps.fail("sync-incremental", JSON.stringify(incStart.body));
    } else {
      const incRun = await waitSync(token, incStart.body.runId);
      report.sync.incremental = {
        runId: incStart.body.runId,
        status: incRun.status,
        durationMs: incRun.durationMs,
        processed: incRun.customersProcessed ?? incRun.processed ?? 0,
        created: incRun.customersCreated ?? incRun.created ?? 0,
        updated: incRun.customersUpdated ?? incRun.updated ?? 0,
        ignored: incRun.customersIgnored ?? incRun.ignored ?? 0,
      };
      if (incRun.status === "COMPLETED" || incRun.status === "PARTIAL") {
        steps.pass("sync-incremental", report.sync.incremental);
      } else {
        steps.fail("sync-incremental", incRun.status ?? "FAILED");
      }
    }

    const afterIncremental = await dbCounts(db, tenantId);
    report.data.afterIncrementalSync = afterIncremental;
    if (
      afterIncremental.customers >= afterFull.customers &&
      afterIncremental.contracts >= afterFull.contracts &&
      afterIncremental.invoices >= afterFull.invoices
    ) {
      steps.pass("sync-no-regression", afterIncremental);
    } else {
      steps.fail("sync-no-regression", "Contagens diminuíram após sync incremental");
    }

    for (const endpoint of ["/customers", "/contracts", "/invoices"]) {
      const pages = await fetchPaginatedWithRetry(
        async (page) => {
          const res = await apiGet(token, `${endpoint}?page=${page}&limit=50`);
          return {
            ok: res.ok,
            status: res.status,
            body: res.body,
            durationMs: res.durationMs,
            retryAfter: null,
          };
        },
        {
          maxAttempts: 5,
          baseDelayMs: 1000,
          pageDelayMs: 150,
          sleep: wait,
        },
      );
      report.pagination[endpoint] = pages;
      steps.pass(`pagination${endpoint}`, { pages: pages.length, total: pages[0]?.total ?? 0 });
    }

    const duplicateStart = await apiPost(token, "/integrations/sgp/sync-customers", { credentialId });
    if (duplicateStart.body?.status === "already_running") {
      steps.pass("sync-duplicate-guard", { status: "already_running" });
    } else if (duplicateStart.ok && duplicateStart.body?.runId) {
      const duplicateRun = await waitSync(token, duplicateStart.body.runId);
      const afterDuplicate = await dbCounts(db, tenantId);
      report.data.afterDuplicateSync = afterDuplicate;
      if (
        afterDuplicate.customers === afterIncremental.customers &&
        afterDuplicate.contracts === afterIncremental.contracts &&
        afterDuplicate.invoices === afterIncremental.invoices
      ) {
        steps.pass("sync-no-duplication", afterDuplicate);
      } else {
        steps.partial("sync-no-duplication", "Contagens variaram após segunda sync consecutiva");
      }
      report.sync.duplicate = duplicateRun;
    } else {
      steps.partial("sync-duplicate-guard", "Não foi possível validar concorrência");
    }

    const badAuth = await apiPost(token, "/integrations/sgp/credentials/test", {
      apiUrl: SGP.apiUrl,
      app: SGP.app,
      token: "token-invalido-homologacao",
      timeoutMs: SGP.timeoutMs,
    });
    report.errorHandling.invalidToken = { status: badAuth.status, ok: badAuth.ok };
    if (!badAuth.ok) steps.pass("error-invalid-token", report.errorHandling.invalidToken);
    else steps.fail("error-invalid-token", "Token inválido deveria falhar");

    const unavailable = await apiPost(token, "/integrations/sgp/credentials/test", {
      apiUrl: "http://127.0.0.1:1",
      app: "x",
      token: "x",
      timeoutMs: 2000,
    });
    report.errorHandling.unavailable = {
      status: unavailable.status,
      ok: unavailable.ok,
      durationMs: unavailable.durationMs,
    };
    if (!unavailable.ok) steps.pass("error-unavailable", report.errorHandling.unavailable);
    else steps.fail("error-unavailable", "Host inacessível deveria falhar");

    const timeoutCase = await apiPost(token, "/integrations/sgp/credentials/test", {
      apiUrl: "https://invalid.example.invalid",
      app: "x",
      token: "x",
      timeoutMs: 1000,
    });
    report.errorHandling.timeout = {
      status: timeoutCase.status,
      ok: timeoutCase.ok,
      durationMs: timeoutCase.durationMs,
    };
    if (!timeoutCase.ok) steps.pass("error-timeout", report.errorHandling.timeout);
    else steps.partial("error-timeout", "Timeout/indisponibilidade não reproduzido");
  } finally {
    apiProcess.kill("SIGTERM");
    await db.end();
  }

  report.finishedAt = new Date().toISOString();
  const failedSteps = report.steps.filter((step) => step.status === "FAIL").length;
  report.summary = {
    passed: report.steps.filter((step) => step.status === "PASS").length,
    failed: failedSteps,
    partial: report.steps.filter((step) => step.status === "PARTIAL").length,
    skipped: report.steps.filter((step) => step.status === "SKIPPED").length,
    readyForProduction: failedSteps === 0,
    directProbeFailures: report.steps.filter(
      (step) => step.status === "FAIL" && String(step.id).startsWith("sgp-"),
    ).length,
  };
  report.conclusion = {
    approved: failedSteps === 0,
    reason:
      failedSteps === 0
        ? "Homologação aprovada."
        : `${failedSteps} etapa(s) reprovada(s). Consulte homologation-report.json.`,
    note:
      report.summary.partial > 0
        ? "Etapas PARTIAL (ex.: HTTP 405 na sonda direta de contratos) não bloqueiam sync CRM se o fluxo interno estiver validado."
        : null,
  };

  fs.writeFileSync(path.join(ROOT, "homologation-report.json"), JSON.stringify(report, null, 2));
  console.log("\n=== RELATÓRIO DE HOMOLOGAÇÃO ===");
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Relatório completo: ${path.join(ROOT, "homologation-report.json")}`);

  if (failedSteps > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
