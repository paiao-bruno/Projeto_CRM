#!/usr/bin/env node
/**
 * Investigação do fluxo SGP REAL (sem mock).
 *
 * Variáveis obrigatórias:
 *   SGP_API_URL, SGP_APP, SGP_TOKEN
 *
 * Opcional:
 *   DATABASE_URL — para contagens no banco
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { callSgpDirect, resolveHomologationCredentials, summarizeSgpBody } from "./lib/sgp-homologation.mjs";

const ROOT = process.cwd();
const SGP = resolveHomologationCredentials(process.env);
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:51214/isp_crm?schema=public";

const ENDPOINTS = [
  { name: "clientes", path: "/api/ura/clientes/" },
  { name: "contratos", path: "/api/contrato/list/" },
  { name: "titulos", path: "/api/ura/titulos/" },
];

const report = {
  startedAt: new Date().toISOString(),
  mode: "real-sgp-investigation",
  prerequisites: {},
  endpoints: {},
  mappingAnalysis: {},
  database: {},
  rootCause: {},
};

function summarizeBody(body) {
  return summarizeSgpBody(body);
}

async function callSgp(endpoint, payload = {}) {
  const result = await callSgpDirect(SGP, endpoint.path, {
    offset: 0,
    limit: 5,
    ...payload,
  });
  return {
    ok: result.ok,
    status: result.status,
    summary: summarizeBody(result.body),
    structure: result.structure,
    body: result.body,
  };
}

async function dbCounts() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const tables = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('Customer','Contract','Invoice')`,
    );
    if (tables.rows.length < 3) {
      return { available: false, reason: "schema_not_migrated" };
    }

    const q = async (sql) => (await client.query(sql)).rows[0]?.c ?? 0;
    return {
      available: true,
      customersActive: await q(`SELECT COUNT(*)::int c FROM "Customer" WHERE "deletedAt" IS NULL`),
      customersDeleted: await q(`SELECT COUNT(*)::int c FROM "Customer" WHERE "deletedAt" IS NOT NULL`),
      contractsActive: await q(`SELECT COUNT(*)::int c FROM "Contract" WHERE "deletedAt" IS NULL`),
      contractsDeleted: await q(`SELECT COUNT(*)::int c FROM "Contract" WHERE "deletedAt" IS NOT NULL`),
      invoicesActive: await q(`SELECT COUNT(*)::int c FROM "Invoice" WHERE "deletedAt" IS NULL`),
      invoicesDeleted: await q(`SELECT COUNT(*)::int c FROM "Invoice" WHERE "deletedAt" IS NOT NULL`),
    };
  } finally {
    await client.end();
  }
}

function analyzeMapping(clientesBody, contratosBody, titulosBody) {
  const clientes = clientesBody?.body?.clientes ?? clientesBody?.body?.data ?? [];
  const contratosRoot =
    contratosBody?.body?.contratos ??
    contratosBody?.body?.contrato ??
    contratosBody?.body?.data ??
    [];
  const titulosRoot =
    titulosBody?.body?.titulos ??
    titulosBody?.body?.títulos ??
    titulosBody?.body?.titulo ??
    titulosBody?.body?.data ??
    [];

  const firstCustomer = Array.isArray(clientes) ? clientes[0] : null;
  const nestedContracts =
    firstCustomer && typeof firstCustomer === "object"
      ? firstCustomer.contratos ?? firstCustomer.contrato ?? firstCustomer.__sgpContratos
      : null;
  const nestedTitles =
    firstCustomer && typeof firstCustomer === "object"
      ? firstCustomer.titulos ?? firstCustomer.títulos ?? firstCustomer.titulo ?? firstCustomer.__sgpTitulos
      : null;

  return {
    clientesCount: Array.isArray(clientes) ? clientes.length : 0,
    contratosInClientesEndpoint: {
      root: Array.isArray(contratosRoot) ? contratosRoot.length : nestedContracts ? 1 : 0,
      nestedInFirstCustomer: Array.isArray(nestedContracts)
        ? nestedContracts.length
        : nestedContracts
          ? 1
          : 0,
    },
    titulosInClientesEndpoint: {
      root: Array.isArray(titulosRoot) ? titulosRoot.length : nestedTitles ? 1 : 0,
      nestedInFirstCustomer: Array.isArray(nestedTitles)
        ? nestedTitles.length
        : nestedTitles
          ? 1
          : 0,
    },
    dedicatedContratosCount: Array.isArray(contratosRoot) ? contratosRoot.length : 0,
    dedicatedTitulosCount: Array.isArray(titulosRoot) ? titulosRoot.length : 0,
    firstCustomerKeys:
      firstCustomer && typeof firstCustomer === "object" ? Object.keys(firstCustomer) : [],
  };
}

async function main() {
  if (!SGP.apiUrl || !SGP.app || !SGP.token) {
    report.prerequisites.missing = ["SGP_API_URL", "SGP_APP", "SGP_TOKEN"].filter(
      (key) => !process.env[key]?.trim(),
    );
    fs.writeFileSync(
      path.join(ROOT, "sgp-investigation-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.error(
      "Defina SGP_API_URL, SGP_APP e SGP_TOKEN para investigar a API SGP real.",
    );
    process.exit(2);
  }

  report.prerequisites = {
    sgpApiUrl: SGP.apiUrl.replace(/\/\/[^@]+@/, "//***@"),
    sgpApp: SGP.app,
    tokenConfigured: true,
  };

  for (const endpoint of ENDPOINTS) {
    report.endpoints[endpoint.name] = await callSgp(endpoint);
  }

  report.mappingAnalysis = analyzeMapping(
    report.endpoints.clientes,
    report.endpoints.contratos,
    report.endpoints.titulos,
  );

  try {
    report.database = await dbCounts();
  } catch (error) {
    report.database = {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const clientesHasChildren =
    report.mappingAnalysis.contratosInClientesEndpoint.root > 0 ||
    report.mappingAnalysis.contratosInClientesEndpoint.nestedInFirstCustomer > 0 ||
    report.mappingAnalysis.titulosInClientesEndpoint.root > 0 ||
    report.mappingAnalysis.titulosInClientesEndpoint.nestedInFirstCustomer > 0;

  report.rootCause = {
    customerEndpoint: "/api/ura/clientes/",
    contractEndpoint: "/api/contrato/list/",
    titleEndpoint: "/api/ura/titulos/",
    clientesPayloadIncludesContractsOrInvoices: clientesHasChildren,
    dedicatedEndpointsRequired: !clientesHasChildren,
    failureStageWhenMissing:
      "mapSgpCustomer() em IntegrationsService retorna contracts/invoices vazios; upsertContracts/upsertInvoices não persistem registros",
    file: "apps/api/src/modules/integrations/integrations.service.ts",
    functions: ["processSgpCustomers", "mapSgpCustomer"],
    incorrectImplementation:
      "Sync utilizava apenas /api/ura/clientes/ e esperava contratos/títulos aninhados ou no root da mesma resposta",
    definitiveFix:
      "Sincronizar contratos via /api/contrato/list/ e faturas via /api/ura/titulos/ em fases dedicadas após clientes",
  };

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(ROOT, "sgp-investigation-report.json"),
    JSON.stringify(report, null, 2),
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
