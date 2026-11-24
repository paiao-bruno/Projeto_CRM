import { after } from "next/server";
import { requireAuth } from "@/server/auth";
import { getDashboardChurnService } from "@/server/dashboard-churn";
import { jsonData, jsonError } from "@/server/http";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    after(() => {
      void getDashboardChurnService().ensure(user.tenantId).catch(() => undefined);
    });
    return jsonData({ user });
  } catch (error) {
    return jsonError(error);
  }
}
