import { route } from "@/server/route-kit";
import { getDashboardChurnService } from "@/server/dashboard-churn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("dashboard.read", ({ user, query }) => getDashboardChurnService().overview(user, query));
