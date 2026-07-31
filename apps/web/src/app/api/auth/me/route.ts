import { requireAuth } from "@/server/auth";
import { jsonData, jsonError } from "@/server/http";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    return jsonData({ user });
  } catch (error) {
    return jsonError(error);
  }
}
