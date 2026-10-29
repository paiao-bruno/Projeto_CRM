import { getAccessService } from "@/server/access";
import { publicRoute } from "@/server/route-kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = publicRoute(({ body }) => getAccessService().resetPassword(body.token, body.password));
