import { NextRequest } from "next/server";
import { requireAuth, requirePermission } from "@/server/auth";
import { HttpError, jsonData, jsonError, parseDealFilters } from "@/server/http";
import {
  createSalesFunnelMetricsService,
  createSalesFunnelService,
} from "@/server/sales-funnel";

const salesFunnelService = createSalesFunnelService();
const metricsService = createSalesFunnelMetricsService();

type RouteContext = { params: Promise<{ path: string[] }> };

async function resolvePath(context: RouteContext) {
  const { path } = await context.params;
  return path ?? [];
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    requirePermission(user, "sales_funnel.read");

    const path = await resolvePath(context);
    const query = parseDealFilters(request.nextUrl.searchParams);

    if (path.length === 1 && path[0] === "board") {
      return jsonData(
        await salesFunnelService.getBoard(user, {
          ...query,
          createdFrom: query.createdFrom ? new Date(query.createdFrom) : undefined,
          createdTo: query.createdTo ? new Date(query.createdTo) : undefined,
        }),
      );
    }

    if (path.length === 1 && path[0] === "deals") {
      return jsonData(await salesFunnelService.listDeals(user, query));
    }

    if (path.length === 2 && path[0] === "deals") {
      return jsonData(await salesFunnelService.getDeal(user, path[1]));
    }

    if (path.length === 1 && path[0] === "members") {
      return jsonData(await salesFunnelService.listMembers(user.tenantId));
    }

    if (path.length === 1 && path[0] === "metrics") {
      return jsonData(await metricsService.getMetrics(user.tenantId, query));
    }

    throw new HttpError(404, "Rota não encontrada.");
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    requirePermission(user, "sales_funnel.manage");

    const path = await resolvePath(context);
    const body = await request.json();

    if (path.length === 1 && path[0] === "deals") {
      return jsonData(await salesFunnelService.createDeal(user, body));
    }

    if (path.length === 3 && path[0] === "deals" && path[2] === "move") {
      return jsonData(await salesFunnelService.moveDeal(user, path[1], body));
    }

    if (path.length === 3 && path[0] === "deals" && path[2] === "mark-lost") {
      return jsonData(await salesFunnelService.markLost(user, path[1], body));
    }

    if (path.length === 3 && path[0] === "deals" && path[2] === "archive") {
      return jsonData(await salesFunnelService.archiveDeal(user, path[1]));
    }

    if (path.length === 3 && path[0] === "deals" && path[2] === "restore") {
      return jsonData(await salesFunnelService.restoreDeal(user, path[1]));
    }

    throw new HttpError(404, "Rota não encontrada.");
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    requirePermission(user, "sales_funnel.manage");

    const path = await resolvePath(context);
    const body = await request.json();

    if (path.length === 2 && path[0] === "deals") {
      return jsonData(await salesFunnelService.updateDeal(user, path[1], body));
    }

    throw new HttpError(404, "Rota não encontrada.");
  } catch (error) {
    return jsonError(error);
  }
}
