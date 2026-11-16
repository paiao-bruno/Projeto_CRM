import { route } from "@/server/route-kit";
import { getRecordsService } from "@/server/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("customers.manage", ({ user, query }) => getRecordsService().listCustomers(user, query));
export const POST = route("customers.manage", ({ user, body }) => getRecordsService().createCustomer(user, body), 201);
