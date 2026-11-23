import { route } from "@/server/route-kit";
import { getDashboardCommercialService } from "@/server/dashboard-commercial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("dashboard.read", ({ user, query }) => getDashboardCommercialService().commercial(user, query));
