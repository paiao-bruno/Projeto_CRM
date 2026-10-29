import { route } from "@/server/route-kit";
import { getChannelsService } from "@/server/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = route("crm.manage", ({ user, params, body }) => getChannelsService().update(user, String(params.id), body));
