import { IntegrationProvider } from "@prisma/client";
import { getPrisma } from "./prisma";
import { probeSgpAuth, SgpReadError } from "./sgp-churn-client";
import { decryptSgpSecrets } from "./sgp-secret-decrypt";
import { CHURN_INTEGRATION_NAME } from "./sgp-churn-credentials";

function configOf(config: unknown) {
  return config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[sgp-churn-inspect] DATABASE_URL ausente.");
    process.exit(1);
  }
  const prisma = getPrisma();
  const rows = await prisma.integration.findMany({
    where: { provider: IntegrationProvider.SGP },
    include: { tenant: { select: { id: true, slug: true, name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const listed = rows.map((row) => {
    const secrets = decryptSgpSecrets(row.encryptedSecrets);
    const config = configOf(row.config);
    const apiUrl = typeof config.apiUrl === "string" ? config.apiUrl : "";
    let host: string | null = null;
    try {
      host = apiUrl ? new URL(apiUrl).host : null;
    } catch {
      host = null;
    }
    return {
      appLooksLikeEmail: Boolean(secrets?.app?.includes("@")),
      tenantId: row.tenantId,
      tenantSlug: row.tenant.slug,
      tenantName: row.tenant.name,
      integrationId: row.id,
      name: row.name,
      dedicated: row.name === CHURN_INTEGRATION_NAME,
      decryptOk: Boolean(secrets),
      app: secrets?.app ?? null,
      apiHost: host,
      authState: String(config.sgpChurnAuth ?? ""),
      purpose: typeof config.purpose === "string" ? config.purpose : null,
    };
  });
  console.log(JSON.stringify({ action: "list", count: listed.length, integrations: listed }));

  const slug = String(process.env.SGP_CHURN_TENANT_SLUG ?? "").trim();
  if (!slug) {
    console.error("[sgp-churn-inspect] Informe SGP_CHURN_TENANT_SLUG para o Teste 2 (persistido). Não usa o primeiro tenant.");
    process.exit(listed.length ? 0 : 2);
  }
  const selected = listed.filter((row) => row.tenantSlug === slug);
  if (!selected.length) {
    console.error("[sgp-churn-inspect] Nenhuma integração SGP nesse slug.");
    process.exit(2);
  }
  const chosen = selected.find((row) => row.dedicated && row.decryptOk) ?? selected.find((row) => row.decryptOk);
  if (!chosen) {
    console.error("[sgp-churn-inspect] Integrações nesse slug não decifraram.");
    process.exit(2);
  }
  const full = rows.find((row) => row.id === chosen.integrationId);
  const secrets = decryptSgpSecrets(full?.encryptedSecrets ?? null);
  const apiUrl = String(configOf(full?.config).apiUrl ?? "");
  if (!secrets || !apiUrl) {
    console.error("[sgp-churn-inspect] Sem App/Token/URL após decifrar.");
    process.exit(2);
  }
  try {
    await probeSgpAuth({ apiUrl, app: secrets.app, token: secrets.token });
    console.log(
      JSON.stringify({
        action: "test2_persisted",
        tenantSlug: slug,
        integrationId: chosen.integrationId,
        dedicated: chosen.dedicated,
        decrypt: "ok",
        method: "POST",
        path: "/api/ura/clientes/",
        result: "contract_ok",
      }),
    );
    process.exit(0);
  } catch (error) {
    const read = error instanceof SgpReadError ? error : null;
    console.log(
      JSON.stringify({
        action: "test2_persisted",
        tenantSlug: slug,
        integrationId: chosen.integrationId,
        dedicated: chosen.dedicated,
        decrypt: "ok",
        method: "POST",
        path: "/api/ura/clientes/",
        result: "fail",
        code: read?.code ?? "unknown",
        httpStatus: read?.httpStatus ?? null,
        message: read?.message ?? "falha",
      }),
    );
    process.exit(2);
  }
}

void main().catch((error) => {
  console.error(`[sgp-churn-inspect] ${error instanceof Error ? error.message : "falha"}`);
  process.exit(1);
});
