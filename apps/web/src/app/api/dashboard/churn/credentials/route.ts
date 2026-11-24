import { route } from "@/server/route-kit";
import { getSgpChurnCredentialsService } from "@/server/sgp-churn-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("dashboard.read", ({ user }) => getSgpChurnCredentialsService().getPublic(user));
export const PATCH = route("customers.manage", ({ user, body }) => getSgpChurnCredentialsService().save(user, body));
