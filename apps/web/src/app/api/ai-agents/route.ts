import { route } from "@/server/route-kit";
import { getAiAgentsService } from "@/server/ai-agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("ai_agents.manage", ({ user }) => getAiAgentsService().list(user));
export const POST = route("ai_agents.manage", ({ user, body }) => getAiAgentsService().create(user, body), 201);
