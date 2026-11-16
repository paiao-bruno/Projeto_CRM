import { route } from "@/server/route-kit";
import { getRecordsService } from "@/server/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("customers.manage", ({ user, params, query }) => getRecordsService().listInvoices(user, query, String(params.id)));
