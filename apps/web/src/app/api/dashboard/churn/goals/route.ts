import { route } from "@/server/route-kit";
import { getDashboardChurnService } from "@/server/dashboard-churn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = route("customers.manage", ({ user, body }) => getDashboardChurnService().upsertGoal(user, body));
