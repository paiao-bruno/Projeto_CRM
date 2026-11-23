import { route } from "@/server/route-kit";
import { getDashboardCommercialService } from "@/server/dashboard-commercial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = route("customers.manage", ({ user, body }) => getDashboardCommercialService().upsertGoal(user, body));
