import { route } from "@/server/route-kit";
import { getChannelsService } from "@/server/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route("crm.manage", ({ user, params }) => getChannelsService().rotateSecret(user, String(params.id)));
