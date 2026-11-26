import { getPrisma } from "./prisma";
import { clearSgpChurnAuthRetry, getDashboardChurnService } from "./dashboard-churn";
import { getSgpChurnCredentialsService } from "./sgp-churn-credentials";
import { probeSgpAuth } from "./sgp-churn-client";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[sgp-churn] DATABASE_URL ausente.");
    process.exit(1);
  }
  const creds = getSgpChurnCredentialsService();
  const saved = await creds.provisionFromServerEnv();
  const tenant = await getPrisma().tenant.findUnique({
    where: { slug: saved.tenantSlug },
    select: { id: true },
  });
  if (!tenant) {
    console.error("[sgp-churn] tenant persistido não resolvido.");
    process.exit(1);
  }
  clearSgpChurnAuthRetry(tenant.id);
  const live = await creds.runtime(tenant.id);
  let authentication: "accepted" | "denied" | "skipped" = "skipped";
  if (live) {
    try {
      await probeSgpAuth({ apiUrl: live.apiUrl, app: live.app, token: live.token });
      await creds.markAuth(tenant.id, live.integrationId, true);
      authentication = "accepted";
    } catch (error) {
      authentication = "denied";
      const message = error instanceof Error ? error.message : "falha";
      await creds.markAuth(tenant.id, live.integrationId, false, message);
      console.error(`[sgp-churn] autenticação: ${message}`);
    }
  }
  let sync = "not_started";
  if (authentication === "accepted") {
    const result = await getDashboardChurnService().ensure(tenant.id, { force: true });
    sync = result.status;
  }
  console.log(
    JSON.stringify({
      tenantSlug: saved.tenantSlug,
      tenantName: saved.tenantName,
      apiHost: saved.apiHost,
      app: saved.provision.app,
      tokenConfigured: saved.tokenConfigured,
      encryptionReady: saved.encryptionReady,
      authentication,
      sync,
    }),
  );
  process.exit(authentication === "accepted" ? 0 : 2);
}

void main().catch((error) => {
  console.error(`[sgp-churn] ${error instanceof Error ? error.message : "falha"}`);
  process.exit(1);
});
