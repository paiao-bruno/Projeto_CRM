import { route } from "@/server/route-kit";
import { getAiAgentsService } from "@/server/ai-agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route("ai_agents.manage", ({ user, params }) => getAiAgentsService().toggle(user, String(params.id)));
export const PATCH = POST;
