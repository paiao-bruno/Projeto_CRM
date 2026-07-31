import { login } from "@/server/auth";
import { jsonData, jsonError } from "@/server/http";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const result = await login(body.email ?? "", body.password ?? "");
    return jsonData(result);
  } catch (error) {
    return jsonError(error);
  }
}
