import { route } from "@/server/route-kit";
import { clearSgpChurnAuthRetry, getDashboardChurnService } from "@/server/dashboard-churn";
import { getSgpChurnCredentialsService } from "@/server/sgp-churn-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("dashboard.read", ({ user }) => getSgpChurnCredentialsService().getPublic(user));
export const PATCH = route("crm.manage", async ({ user, body }) => {
  clearSgpChurnAuthRetry(user.tenantId);
  const saved = await getSgpChurnCredentialsService().save(user, body);
  void getDashboardChurnService().ensure(user.tenantId, { force: true }).catch(() => undefined);
  return saved;
});
