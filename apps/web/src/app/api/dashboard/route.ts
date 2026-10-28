import { route } from "@/server/route-kit";
import { getDashboardService } from "@/server/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("dashboard.read", ({ user }) => getDashboardService().overview(user));
