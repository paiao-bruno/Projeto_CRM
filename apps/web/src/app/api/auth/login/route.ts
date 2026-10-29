import { login } from "@/server/auth";
import { publicRoute } from "@/server/route-kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = publicRoute(({ request, body }) =>
  login(String(body.email ?? ""), String(body.password ?? ""), {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  }),
);
