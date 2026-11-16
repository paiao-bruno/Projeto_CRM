import { route } from "@/server/route-kit";
import { getChannelsService } from "@/server/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("crm.manage", ({ user }) => getChannelsService().list(user));
export const POST = route("crm.manage", ({ user, body }) => getChannelsService().create(user, body), 201);
