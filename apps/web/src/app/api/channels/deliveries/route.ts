import { route } from "@/server/route-kit";
import { getChannelsService } from "@/server/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("crm.manage", ({ user, query }) => getChannelsService().deliveries(user, query));
