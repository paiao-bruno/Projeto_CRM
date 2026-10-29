import { logout } from "@/server/auth";
import { route } from "@/server/route-kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(null, ({ user }) => logout(user));
