import { jsonData } from "@/server/http";
import { getPrisma } from "@/server/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ok" | "unavailable" = "ok";
  try {
    await getPrisma().$queryRaw`SELECT 1`;
  } catch {
    database = "unavailable";
  }
  return jsonData({ status: database === "ok" ? "ok" : "degraded", mode: "single-site", database });
}
