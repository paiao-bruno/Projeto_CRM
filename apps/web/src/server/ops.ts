import type { Prisma, PrismaClient } from "@prisma/client";
import type { ServerAuthUser } from "./auth";
import { recordAudit } from "./audit";
import { HttpError } from "./http";
import { InboxService } from "./inbox/service";
import { isSupervisor, actorFrom } from "./inbox/rules";
import { getPrisma } from "./prisma";
import { parsePaging, paged, requireUuid } from "./validation";

const DATE_FIELDS = ["createdAt", "lastMessageAt", "closedAt"] as const;

export class OpsService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /** Qual data está sendo filtrada vem no próprio resultado (`dateField`). */
  async search(user: ServerAuthUser, query: URLSearchParams) {
    if (!isSupervisor(actorFrom(user))) throw new HttpError(403, "Permissão insuficiente.");
    const { page, limit } = parsePaging(query, 30, 100);
    const dateField = (DATE_FIELDS as readonly string[]).includes(query.get("dateField") ?? "")
      ? (query.get("dateField") as (typeof DATE_FIELDS)[number])
      : "createdAt";
    const from = query.get("from") ? new Date(query.get("from")!) : null;
    const to = query.get("to") ? new Date(query.get("to")!) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      throw new HttpError(422, "Período inválido.");
    }
    const and: Prisma.ConversationWhereInput[] = [{ tenantId: user.tenantId }];
    if (query.get("protocol")) and.push({ protocol: { contains: query.get("protocol")!, mode: "insensitive" } });
    if (query.get("status")) and.push({ status: query.get("status") as never });
    if (query.get("sectorId")) and.push({ sectorId: requireUuid(query.get("sectorId"), "sectorId") });
    if (query.get("channelId")) and.push({ channelIntegrationId: requireUuid(query.get("channelId"), "channelId") });
    if (query.get("operatorId")) and.push({ assignedMemberId: requireUuid(query.get("operatorId"), "operatorId") });
    if (query.get("closeReason")) and.push({ closeReason: query.get("closeReason")! });
    if (query.get("contact")) {
      const contact = query.get("contact")!;
      and.push({
        OR: [
          { customer: { name: { contains: contact, mode: "insensitive" } } },
          ...(contact.replace(/\D/g, "").length >= 3 ? [{ customer: { phone: { contains: contact.replace(/\D/g, "") } } }] : []),
        ],
      });
    }
    if (query.get("text")) {
      and.push({ messages: { some: { body: { contains: query.get("text")!, mode: "insensitive" } } } });
    }
    if (from || to) {
      and.push({ [dateField]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
    }
    const where: Prisma.ConversationWhereInput = { AND: and };
    const [items, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: { [dateField]: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          assignedMember: { select: { id: true, displayName: true, user: { select: { name: true } } } },
          sector: { select: { id: true, name: true } },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);
    return {
      ...paged(
        items.map((item) => ({
          id: item.id,
          protocol: item.protocol,
          status: item.status,
          closeReason: item.closeReason,
          createdAt: item.createdAt,
          lastMessageAt: item.lastMessageAt,
          closedAt: item.closedAt,
          customer: item.customer,
          sector: item.sector,
          assignee: item.assignedMember
            ? { id: item.assignedMember.id, name: item.assignedMember.displayName ?? item.assignedMember.user.name }
            : null,
        })),
        total,
        page,
        limit,
      ),
      dateField,
      filters: Object.fromEntries([...query.entries()]),
    };
  }

  async exportCsv(user: ServerAuthUser, query: URLSearchParams) {
    const result = await this.search(user, new URLSearchParams({ ...Object.fromEntries(query), page: "1", limit: "500" }));
    const header = ["protocolo", "status", "contato", "telefone", "setor", "responsavel", "motivo", "criadoEm", "ultimaMensagem", "encerradoEm"];
    const lines = [header.join(";")];
    for (const row of result.data) {
      lines.push(
        [
          row.protocol ?? "",
          row.status,
          row.customer?.name ?? "",
          row.customer?.phone ?? "",
          row.sector?.name ?? "",
          row.assignee?.name ?? "",
          row.closeReason ?? "",
          row.createdAt.toISOString(),
          row.lastMessageAt?.toISOString() ?? "",
          row.closedAt?.toISOString() ?? "",
        ]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(";"),
      );
    }
    return { filename: "historico-atendimentos.csv", csv: lines.join("\n"), total: result.total, truncated: result.total > 500 };
  }

  async previewBatch(user: ServerAuthUser, ids: string[]) {
    if (!isSupervisor(actorFrom(user))) throw new HttpError(403, "Permissão insuficiente.");
    const unique = [...new Set(ids.map((id) => requireUuid(id)))];
    if (unique.length === 0 || unique.length > 100) throw new HttpError(422, "Selecione entre 1 e 100 atendimentos.");
    const items = await this.prisma.conversation.findMany({
      where: { tenantId: user.tenantId, id: { in: unique } },
      select: { id: true, protocol: true, status: true, assignedMemberId: true, version: true },
    });
    return {
      requested: unique.length,
      found: items.length,
      missing: unique.length - items.length,
      byStatus: Object.fromEntries(
        ["OPEN", "PENDING", "SOLVED", "ARCHIVED"].map((status) => [status, items.filter((item) => item.status === status).length]),
      ),
      items,
    };
  }

  async runBatch(user: ServerAuthUser, body: { ids?: unknown; action?: unknown; toMemberId?: unknown; reason?: unknown }) {
    if (!isSupervisor(actorFrom(user))) throw new HttpError(403, "Permissão insuficiente.");
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => requireUuid(id)) : [];
    const preview = await this.previewBatch(user, ids);
    const action = String(body.action ?? "");
    if (!["assign", "transfer", "close"].includes(action)) throw new HttpError(422, "action inválida.");
    const inbox = new InboxService(this.prisma);
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const item of preview.items) {
      try {
        if (action === "close") {
          if (item.status === "SOLVED" || item.status === "ARCHIVED") throw new HttpError(409, "Já encerrado.");
          await inbox.close(user, item.id, { reason: typeof body.reason === "string" ? body.reason : undefined, expectedVersion: item.version });
        } else {
          await inbox.assign(user, item.id, {
            toMemberId: String(body.toMemberId ?? ""),
            reason: typeof body.reason === "string" ? body.reason : undefined,
            expectedVersion: item.version,
          });
        }
        results.push({ id: item.id, ok: true });
      } catch (error) {
        results.push({ id: item.id, ok: false, error: error instanceof HttpError ? error.message : "Falha." });
      }
    }
    await recordAudit(this.prisma, user, `inbox.batch_${action}`, "Conversation", null, {
      requested: preview.requested,
      ok: results.filter((row) => row.ok).length,
    });
    return { preview, results };
  }

  async listAudit(user: ServerAuthUser, query: URLSearchParams) {
    const { page, limit } = parsePaging(query, 50, 200);
    const from = query.get("from") ? new Date(query.get("from")!) : null;
    const to = query.get("to") ? new Date(query.get("to")!) : null;
    const where: Prisma.AuditLogWhereInput = {
      tenantId: user.tenantId,
      ...(query.get("action") ? { action: { contains: query.get("action")!, mode: "insensitive" } } : {}),
      ...(query.get("entityType") ? { entityType: query.get("entityType")! } : {}),
      ...(query.get("actorMemberId") ? { actorMemberId: requireUuid(query.get("actorMemberId"), "actorMemberId") } : {}),
      ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { actorMember: { select: { displayName: true, user: { select: { name: true, email: true } } } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paged(
      items.map((item) => ({
        id: item.id,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        createdAt: item.createdAt,
        actor: item.actorMember
          ? { name: item.actorMember.displayName ?? item.actorMember.user.name, email: item.actorMember.user.email }
          : null,
        metadata: sanitizeMetadata(item.metadata),
      })),
      total,
      page,
      limit,
    );
  }
}

function sanitizeMetadata(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/secret|password|token|authorization|cookie/i.test(key)) {
        out[key] = "[redacted]";
      } else out[key] = sanitizeMetadata(nested);
    }
    return out;
  }
  return value;
}

let singleton: OpsService | null = null;
export function getOpsService() {
  singleton ??= new OpsService();
  return singleton;
}
