import { jsonData } from "@/server/http";

export async function GET() {
  return jsonData({
    status: "ok",
    mode: process.env.NEXT_PUBLIC_WEB_ONLY_MODE === "true" ? "web-only" : "legacy",
    apiBaseUrl: process.env.NEXT_PUBLIC_API_URL ?? null,
  });
}
