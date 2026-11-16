import { route } from "@/server/route-kit";
import { getRecordsService } from "@/server/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("customers.manage", ({ user, params }) => getRecordsService().getCustomer(user, String(params.id)));
export const PATCH = route("customers.manage", ({ user, params, body }) => getRecordsService().updateCustomer(user, String(params.id), body));
export const DELETE = route("customers.manage", ({ user, params }) => getRecordsService().removeCustomer(user, String(params.id)));
