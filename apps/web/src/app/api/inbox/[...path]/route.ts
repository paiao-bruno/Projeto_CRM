import { NextRequest } from "next/server";
import { requireAuth, requirePermission } from "@/server/auth";
import { HttpError, jsonData, jsonError } from "@/server/http";
import { getPrisma } from "@/server/prisma";
import { getInboxService } from "@/server/inbox/service";
import { PERMISSIONS } from "@/server/inbox/rules";

type RouteContext = { params: Promise<{ path: string[] }> };

async function readBody(request: NextRequest): Promise<Record<string, any>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

function demoInboundEnabled() {
  const flag = process.env.VERTICE_DEMO_INBOUND;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

function optionalVersion(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    requirePermission(user, PERMISSIONS.read);
    const { path } = await context.params;
    const service = getInboxService();
    const params = request.nextUrl.searchParams;

    if (path.length === 1 && path[0] === "conversations") {
      return jsonData(
        await service.list(user, {
          tab: params.get("tab") ?? undefined,
          search: params.get("search") ?? undefined,
          page: params.get("page") ? Number(params.get("page")) : undefined,
          limit: params.get("limit") ? Number(params.get("limit")) : undefined,
        }),
      );
    }
    if (path.length === 2 && path[0] === "conversations") {
      return jsonData(await service.get(user, path[1]));
    }
    if (path.length === 1 && path[0] === "members") {
      return jsonData(await service.listMembers(user));
    }
    if (path.length === 1 && path[0] === "capabilities") {
      return jsonData({ demoInbound: demoInboundEnabled() });
    }
    throw new HttpError(404, "Rota nao encontrada.");
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    requirePermission(user, PERMISSIONS.read);
    const { path } = await context.params;
    const service = getInboxService();
    const body = await readBody(request);

    if (path.length === 1 && path[0] === "presence") {
      return jsonData(await service.heartbeat(user, String(body.status ?? "")));
    }

    if (path.length === 1 && path[0] === "demo-inbound") {
      if (!demoInboundEnabled()) throw new HttpError(404, "Rota nao encontrada.");
      requirePermission(user, PERMISSIONS.transfer);
      let channelIntegrationId: string | undefined;
      if (body.channelId !== undefined) {
        const channel = await getPrisma().integration.findFirst({
          where: { id: String(body.channelId), tenantId: user.tenantId, provider: "WEBHOOK", status: "ACTIVE" },
          select: { id: true },
        }).catch(() => null);
        if (!channel) throw new HttpError(422, "channelId invalido.");
        channelIntegrationId = channel.id;
      }
      return jsonData(
        await service.ingestInbound(user.tenantId, {
          channelIntegrationId,
          provider: "demo",
          providerEventId: String(body.providerEventId ?? ""),
          contactName: String(body.contactName ?? ""),
          contactPhone: String(body.contactPhone ?? ""),
          text: String(body.text ?? ""),
        }),
        201,
      );
    }

    if (path.length === 5 && path[0] === "conversations" && path[2] === "messages" && path[4] === "delivery") {
      return jsonData(await service.resolveDelivery(user, path[1], path[3], String(body.action ?? "")));
    }

    if (path.length === 3 && path[0] === "conversations") {
      const id = path[1];
      switch (path[2]) {
        case "claim":
          return jsonData(await service.claim(user, id));
        case "transfer":
          return jsonData(
            await service.transfer(user, id, {
              toMemberId: body.toMemberId,
              reason: body.reason,
              expectedVersion: optionalVersion(body.expectedVersion),
            }),
          );
        case "close":
          return jsonData(
            await service.close(user, id, {
              reason: body.reason,
              expectedVersion: optionalVersion(body.expectedVersion),
            }),
          );
        case "reopen":
          return jsonData(
            await service.reopen(user, id, {
              expectedVersion: optionalVersion(body.expectedVersion),
            }),
          );
        case "messages":
          return jsonData(
            await service.reply(user, id, {
              body: body.body,
              internal: body.internal === true,
              clientMessageId: body.clientMessageId,
            }),
            201,
          );
        case "read":
          return jsonData(await service.markRead(user, id));
      }
    }

    throw new HttpError(404, "Rota nao encontrada.");
  } catch (error) {
    return jsonError(error);
  }
}
