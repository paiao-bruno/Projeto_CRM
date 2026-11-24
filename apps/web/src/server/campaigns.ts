import { Prisma, type PrismaClient } from "@prisma/client";
import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_STATUSES,
  DEFAULT_SALE_ORIGINS,
  originNameKey,
  normalizeOriginName,
} from "@/lib/campaigns";
import type { ServerAuthUser } from "./auth";
import { recordAudit } from "./audit";
import { HttpError } from "./http";
import { getPrisma } from "./prisma";
import {
  optionalEnum,
  optionalString,
  parsePaging,
  paged,
  requireUuid,
  requiredString,
  type Body,
} from "./validation";

export class CampaignsService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async list(user: ServerAuthUser, query: URLSearchParams) {
    const { page, limit } = parsePaging(query, 50, 200);
    const search = query.get("search")?.trim();
    const channel = query.get("channel")?.trim();
    const includeArchived = query.get("includeArchived") !== "false";
    const pinnedIds = [
      ...query.getAll("ids"),
      ...(query.get("ids")?.split(",") ?? []),
    ].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const uniquePinned = [...new Set(pinnedIds)];
    const where: Prisma.CampaignWhereInput = {
      tenantId: user.tenantId,
      ...(includeArchived ? {} : { archivedAt: null }),
      ...(channel ? { channel } : {}),
      ...(search
        ? { name: { contains: search, mode: "insensitive" } }
        : {}),
    };
    const [data, total, pinned] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        orderBy: [{ archivedAt: "asc" }, { updatedAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { deals: true, recipients: true } } },
      }),
      this.prisma.campaign.count({ where }),
      uniquePinned.length
        ? this.prisma.campaign.findMany({
            where: { tenantId: user.tenantId, id: { in: uniquePinned } },
            include: { _count: { select: { deals: true, recipients: true } } },
          })
        : Promise.resolve([]),
    ]);
    const seen = new Set(data.map((item) => item.id));
    const merged = [...pinned.filter((item) => !seen.has(item.id)), ...data];
    return paged(merged, total, page, limit);
  }

  async get(user: ServerAuthUser, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: requireUuid(id), tenantId: user.tenantId },
      include: {
        _count: { select: { deals: true, recipients: true } },
        deals: {
          where: { archivedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 50,
          select: {
            id: true,
            title: true,
            status: true,
            stage: { select: { name: true, code: true } },
          },
        },
      },
    });
    if (!campaign) throw new HttpError(404, "Campanha não encontrada.");
    return campaign;
  }

  async create(user: ServerAuthUser, body: Body) {
    const channel = optionalEnum(body, "channel", CAMPAIGN_CHANNELS) ?? "LOCAL";
    const campaign = await this.prisma.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: {
          tenantId: user.tenantId,
          name: requiredString(body, "name", 200),
          description: optionalString(body, "description", 2000) ?? undefined,
          channel,
          status: "DRAFT",
          messageTemplate: optionalString(body, "messageTemplate", 20_000) ?? "",
        },
      });
      await recordAudit(tx, user, "campaign.created", "Campaign", created.id);
      return created;
    });
    return campaign;
  }

  async update(user: ServerAuthUser, id: string, body: Body) {
    const existing = await this.requireOwned(user.tenantId, id);
    if (existing.status === "RUNNING") {
      if (body.name !== undefined && requiredString(body, "name", 200) !== existing.name) {
        throw new HttpError(422, "Não é possível renomear uma campanha em envio. Pause-a antes.");
      }
    }
    const data: Prisma.CampaignUpdateInput = {};
    if (body.name !== undefined) data.name = requiredString(body, "name", 200);
    if (body.description !== undefined) data.description = optionalString(body, "description", 2000);
    if (body.channel !== undefined) data.channel = optionalEnum(body, "channel", CAMPAIGN_CHANNELS);
    if (body.status !== undefined) {
      const status = optionalEnum(body, "status", CAMPAIGN_STATUSES);
      if (status) data.status = status;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.update({ where: { id: existing.id }, data });
      await recordAudit(tx, user, "campaign.updated", "Campaign", existing.id, { fields: Object.keys(data) });
      return campaign;
    });
    return updated;
  }

  async archive(user: ServerAuthUser, id: string) {
    const existing = await this.requireOwned(user.tenantId, id);
    if (existing.archivedAt) return existing;
    if (existing.status === "RUNNING") {
      throw new HttpError(422, "Pause ou cancele o envio antes de arquivar.");
    }
    return this.prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.update({
        where: { id: existing.id },
        data: { archivedAt: new Date() },
      });
      await recordAudit(tx, user, "campaign.archived", "Campaign", existing.id);
      return campaign;
    });
  }

  async whatsappOverview(user: ServerAuthUser, query: URLSearchParams) {
    const integration = await this.prisma.integration.findFirst({
      where: { tenantId: user.tenantId, provider: "WHATSAPP", status: "ACTIVE" },
      select: { id: true, updatedAt: true },
    });
    const range = this.periodRange(query.get("period") ?? "30d");
    const campaigns = await this.prisma.campaign.findMany({
      where: { tenantId: user.tenantId, channel: "WHATSAPP", archivedAt: null },
      select: { id: true, status: true },
    });
    const recipientWhere: Prisma.CampaignRecipientWhereInput = {
      tenantId: user.tenantId,
      campaign: { tenantId: user.tenantId, channel: "WHATSAPP" },
      createdAt: { gte: range.from, lte: range.to },
    };
    const [sent, delivered, read, failed, queued] = await Promise.all([
      this.prisma.campaignRecipient.count({ where: { ...recipientWhere, status: { in: ["SENT", "DELIVERED", "READ", "CONVERTED"] } } }),
      this.prisma.campaignRecipient.count({ where: { ...recipientWhere, deliveredAt: { not: null } } }),
      this.prisma.campaignRecipient.count({ where: { ...recipientWhere, readAt: { not: null } } }),
      this.prisma.campaignRecipient.count({ where: { ...recipientWhere, status: "FAILED" } }),
      this.prisma.campaignRecipient.count({
        where: { tenantId: user.tenantId, status: "PENDING", campaign: { tenantId: user.tenantId, channel: "WHATSAPP" } },
      }),
    ]);
    const responded = await this.prisma.campaignEvent.count({
      where: {
        tenantId: user.tenantId,
        type: "reply",
        occurredAt: { gte: range.from, lte: range.to },
        campaign: { tenantId: user.tenantId, channel: "WHATSAPP" },
      },
    });
    return {
      integrationAvailable: Boolean(integration),
      reason: integration
        ? null
        : "Nenhum número WhatsApp ativo nesta organização. Cadastre campanhas locais e associe-as no Funil; o envio fica bloqueado até conectar o canal em Integrações.",
      period: range.key,
      periodFrom: range.from.toISOString(),
      periodTo: range.to.toISOString(),
      lastSyncedAt: integration?.updatedAt.toISOString() ?? null,
      messagingLimit: null,
      quality: null,
      totals: {
        campaigns: campaigns.length,
        sent,
        delivered,
        read,
        responded,
        failed,
        queued,
      },
      rates: {
        delivered: this.rate(delivered, sent),
        read: this.rate(read, delivered),
        responded: this.rate(responded, sent),
        failed: this.rate(failed, sent),
      },
      definitions: {
        responded: "Respostas contam só eventos do tipo reply vinculados à campanha, não o campo comercial do Kanban.",
        limits: "Limites e qualidade do WhatsApp Business vêm da conta conectada. Sem integração, estes dados ficam indisponíveis — não são zero.",
      },
      docs: {
        overview: "https://developers.facebook.com/documentation/business-messaging/whatsapp/overview",
        waba: "https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/",
        policy: "https://business.whatsapp.com/policy",
        pricing: "https://business.whatsapp.com/products/platform-pricing",
        limits: "https://developers.facebook.com/docs/whatsapp/messaging-limits",
      },
    };
  }

  async refuseSend(user: ServerAuthUser, id: string) {
    await this.requireOwned(user.tenantId, id);
    throw new HttpError(
      422,
      "Envio de WhatsApp não está disponível neste ambiente. A associação da campanha no Funil não dispara mensagens.",
    );
  }

  private rate(num: number, den: number) {
    if (!den) return null;
    return num / den;
  }

  private periodRange(period: string) {
    const to = new Date();
    const from = new Date(to);
    let key = period;
    if (period === "7d") from.setDate(from.getDate() - 7);
    else if (period === "90d") from.setDate(from.getDate() - 90);
    else if (period === "month") from.setDate(1);
    else {
      key = "30d";
      from.setDate(from.getDate() - 30);
    }
    return { key, from, to };
  }

  async requireOwned(tenantId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: requireUuid(id), tenantId },
    });
    if (!campaign) throw new HttpError(404, "Campanha não encontrada.");
    return campaign;
  }
}

export class SaleOriginsService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async list(user: ServerAuthUser, query: URLSearchParams) {
    await this.ensureDefaults(user.tenantId);
    const includeInactive = query.get("includeInactive") === "true";
    return this.prisma.saleOrigin.findMany({
      where: {
        tenantId: user.tenantId,
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
  }

  async create(user: ServerAuthUser, body: Body) {
    await this.ensureDefaults(user.tenantId);
    const name = normalizeOriginName(requiredString(body, "name", 80));
    const nameKey = originNameKey(name);
    const existing = await this.prisma.saleOrigin.findUnique({
      where: { tenantId_nameKey: { tenantId: user.tenantId, nameKey } },
    });
    if (existing?.active) throw new HttpError(409, "Já existe uma origem com este nome.");
    if (existing && !existing.active) {
      throw new HttpError(409, "Já existe uma origem inativa com este nome. Reative-a em vez de duplicar.");
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const origin = await tx.saleOrigin.create({
          data: { tenantId: user.tenantId, name, nameKey, active: true },
        });
        await recordAudit(tx, user, "sale_origin.created", "SaleOrigin", origin.id);
        return origin;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "Já existe uma origem com este nome.");
      }
      throw error;
    }
  }

  async update(user: ServerAuthUser, id: string, body: Body) {
    const origin = await this.requireOwned(user.tenantId, id);
    const name = body.name === undefined ? origin.name : normalizeOriginName(requiredString(body, "name", 80));
    const nameKey = originNameKey(name);
    const clash = await this.prisma.saleOrigin.findFirst({
      where: { tenantId: user.tenantId, nameKey, id: { not: origin.id } },
    });
    if (clash) throw new HttpError(409, "Já existe uma origem com este nome.");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.saleOrigin.update({
        where: { id: origin.id },
        data: { name, nameKey },
      });
      await recordAudit(tx, user, "sale_origin.updated", "SaleOrigin", origin.id);
      return updated;
    });
  }

  async setActive(user: ServerAuthUser, id: string, active: boolean) {
    const origin = await this.requireOwned(user.tenantId, id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.saleOrigin.update({
        where: { id: origin.id },
        data: { active },
      });
      await recordAudit(tx, user, active ? "sale_origin.activated" : "sale_origin.deactivated", "SaleOrigin", origin.id);
      return updated;
    });
  }

  async ensureDefaults(tenantId: string) {
    const existing = await this.prisma.saleOrigin.findMany({
      where: { tenantId },
      select: { nameKey: true },
    });
    const have = new Set(existing.map((item) => item.nameKey));
    const missing = DEFAULT_SALE_ORIGINS.filter((name) => !have.has(originNameKey(name)));
    if (missing.length === 0) return;
    await this.prisma.saleOrigin.createMany({
      data: missing.map((name) => ({
        tenantId,
        name,
        nameKey: originNameKey(name),
        active: true,
      })),
      skipDuplicates: true,
    });
  }

  private async requireOwned(tenantId: string, id: string) {
    const origin = await this.prisma.saleOrigin.findFirst({
      where: { id: requireUuid(id), tenantId },
    });
    if (!origin) throw new HttpError(404, "Origem não encontrada.");
    return origin;
  }
}

let campaignsService: CampaignsService | undefined;
let originsService: SaleOriginsService | undefined;

export function getCampaignsService() {
  campaignsService ??= new CampaignsService();
  return campaignsService;
}

export function getSaleOriginsService() {
  originsService ??= new SaleOriginsService();
  return originsService;
}
