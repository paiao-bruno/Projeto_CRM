import { route } from "@/server/route-kit";
import { getRecordsService } from "@/server/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("customers.manage", ({ user, query }) => getRecordsService().listContracts(user, query));
export const POST = route("customers.manage", ({ user, body }) => getRecordsService().createContract(user, body), 201);
