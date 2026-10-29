import { route } from "@/server/route-kit";
import { getAiAgentsService } from "@/server/ai-agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("ai_agents.manage", ({ user, params }) => getAiAgentsService().get(user, String(params.id)));
export const PATCH = route("ai_agents.manage", ({ user, params, body }) => getAiAgentsService().update(user, String(params.id), body));
export const DELETE = route("ai_agents.manage", ({ user, params }) => getAiAgentsService().remove(user, String(params.id)));
