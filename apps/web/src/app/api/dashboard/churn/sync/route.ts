import { route } from "@/server/route-kit";
import { getDashboardChurnService } from "@/server/dashboard-churn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route("customers.manage", ({ user }) => getDashboardChurnService().sync(user));
