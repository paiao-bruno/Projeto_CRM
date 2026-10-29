import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ServerAuthUser } from "../auth";
import { HttpError } from "../http";
import { getPrisma } from "../prisma";
import { DistributionService } from "../distribution";
import { OutboxService } from "../outbox/service";
import { publishEvent } from "../realtime";
import {
  PERMISSIONS,
  PRESENCE_STATUSES,
  actorFrom,
  type Actor,
  type InboxTab,
  canClaim,
  canClose,
  canReopen,
  canReply,
  canTransfer,
  CLOSE_REASONS,
  canView,
  clampLimit,
  derivePresence,
  formatProtocol,
  has,
  isSupervisor,
  normalizePhone,
  previewText,
} from "./rules";

type Tx = Prisma.TransactionClient;

const ACTIVE_STATUSES = ["OPEN", "PENDING"] as const;

export type InboundInput = {
  provider: string;
  providerEventId: string;
  contactName: string;
  contactPhone: string;
  text: string;
  occurredAt?: string | Date;
  channelIntegrationId?: string;
  sectorId?: string;
};

function requirePerm(actor: Actor, permission: string) {
  if (!has(actor, permission)) throw new HttpError(403, "Permissao insuficiente.");
}

function conflict(message = "A conversa foi alterada por outra pessoa. Atualize a lista e tente novamente.") {
  return new HttpError(409, message);
}

function cleanText(value: unknown, field: string, min: number, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max) {
    throw new HttpError(422, `${field} deve ter entre ${min} e ${max} caracteres.`);
  }
  return text;
}

export class InboxService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /* ------------------------------------------------------------------ */
  /* Entrada de mensagens (idempotente por provider + providerEventId)   */
  /* ------------------------------------------------------------------ */

  async ingestInbound(tenantId: string, input: InboundInput) {
    const provider = String(input.provider ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,40}$/.test(provider)) {
      throw new HttpError(422, "provider invalido.");
    }
    const providerEventId = cleanText(input.providerEventId, "providerEventId", 1, 200);
    const contactName = cleanText(input.contactName, "contactName", 1, 160);
    const text = cleanText(input.text, "text", 1, 4000);
    const phone = normalizePhone(input.contactPhone);
    if (!phone) throw new HttpError(422, "contactPhone invalido.");
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new HttpError(422, "occurredAt invalido.");

    const payloadHash = createHash("sha256")
      .update(JSON.stringify([provider, providerEventId, contactName, phone, text]))
      .digest("hex");

    return this.prisma.$transaction(
      async (tx) => {
        const inserted = await tx.inboundEvent.createMany({
          data: [{ tenantId, provider, providerEventId, payloadHash }],
          skipDuplicates: true,
        });

        if (inserted.count === 0) {
          const existing = await tx.inboundEvent.findUnique({
            where: { tenantId_provider_providerEventId: { tenantId, provider, providerEventId } },
          });
          return {
            duplicate: true as const,
            payloadMismatch: existing ? existing.payloadHash !== payloadHash : false,
            conversationId: existing?.conversationId ?? null,
          };
        }

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${phone}`}))`;

        const customerId = await this.resolveCustomer(tx, tenantId, phone, contactName);

        let conversation = await tx.conversation.findFirst({
          where: { tenantId, customerId, status: { in: [...ACTIVE_STATUSES] } },
          orderBy: { createdAt: "desc" },
        });

        if (!conversation) {
          const protocol = await this.nextProtocol(tx, tenantId);
          conversation = await tx.conversation.create({
            data: {
              tenantId,
              customerId,
              protocol,
              status: "OPEN",
              unreadCount: 1,
              lastMessageAt: occurredAt,
              channelIntegrationId: input.channelIntegrationId,
              sectorId: input.sectorId,
              metadata: { provider },
            },
          });
          await this.logEvent(tx, tenantId, conversation.id, "CREATED", null, { provider });
        } else {
          const reopenedFromPending = conversation.status === "PENDING";
          conversation = await tx.conversation.update({
            where: { id: conversation.id },
            data: {
              unreadCount: { increment: 1 },
              lastMessageAt: occurredAt,
              ...(reopenedFromPending
                ? { status: "OPEN", version: { increment: 1 } }
                : {}),
            },
          });
        }

        await tx.message.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            senderType: "CUSTOMER",
            direction: "INBOUND",
            contentType: "TEXT",
            body: text,
            externalId: `${provider}:${providerEventId}`,
            senderCustomerId: customerId,
            sentAt: occurredAt,
          },
        });

        await tx.inboundEvent.updateMany({
          where: { tenantId, provider, providerEventId },
          data: { conversationId: conversation.id },
        });
        await publishEvent(tx, { type: "message.received", tenantId, conversationId: conversation.id });

        return {
          duplicate: false as const,
          payloadMismatch: false,
          conversationId: conversation.id,
          protocol: conversation.protocol,
        };
      },
      { timeout: 15_000 },
    ).then(async (result) => {
      if (!result.duplicate && result.conversationId) {
        await new DistributionService(this.prisma).distribute(tenantId, result.conversationId).catch(() => undefined);
      }
      return result;
    });
  }

  private async resolveCustomer(tx: Tx, tenantId: string, phone: string, name: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Customer"
      WHERE "tenantId" = ${tenantId}::uuid
        AND "deletedAt" IS NULL
        AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${phone}
      ORDER BY "createdAt" ASC
      LIMIT 1`;
    if (rows[0]) return rows[0].id;
    const created = await tx.customer.create({
      data: { tenantId, name, phone, status: "PROSPECT", metadata: { origin: "inbox" } },
    });
    return created.id;
  }

  private async nextProtocol(tx: Tx, tenantId: string) {
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "TenantCounter" ("tenantId", "key", "value")
      VALUES (${tenantId}::uuid, 'conversation_protocol', 1)
      ON CONFLICT ("tenantId", "key")
      DO UPDATE SET "value" = "TenantCounter"."value" + 1
      RETURNING "value"`;
    return formatProtocol(new Date(), Number(rows[0].value));
  }

  private async logEvent(
    tx: Tx,
    tenantId: string,
    conversationId: string,
    type: string,
    actorMemberId: string | null,
    data?: Prisma.InputJsonValue,
  ) {
    await tx.conversationEvent.create({
      data: { tenantId, conversationId, type, actorMemberId, data },
    });
    await publishEvent(tx, { type: `conversation.${type.toLowerCase()}`, tenantId, conversationId });
  }

  /* ------------------------------------------------------------------ */
  /* Consulta                                                            */
  /* ------------------------------------------------------------------ */

  async list(
    user: ServerAuthUser,
    query: { tab?: string; search?: string; page?: number; limit?: number; sectorId?: string; channelId?: string; operatorId?: string },
  ) {
    const actor = actorFrom(user);
    requirePerm(actor, PERMISSIONS.read);
    const tab = (["queue", "mine", "all", "closed"].includes(query.tab ?? "")
      ? query.tab
      : "queue") as InboxTab;
    if (tab === "all" && !isSupervisor(actor)) {
      throw new HttpError(403, "Permissao insuficiente.");
    }

    const limit = clampLimit(query.limit);
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const base = this.tabWhere(user.tenantId, actor, tab);
    const search = query.search?.trim();
    const extras: Prisma.ConversationWhereInput[] = [];
    if (query.sectorId) extras.push({ sectorId: query.sectorId });
    if (query.channelId) extras.push({ channelIntegrationId: query.channelId });
    if (query.operatorId) extras.push({ assignedMemberId: query.operatorId });
    if (search) {
      extras.push({
        OR: [
          { protocol: { contains: search, mode: "insensitive" } },
          { customer: { name: { contains: search, mode: "insensitive" } } },
          ...(search.replace(/\D/g, "").length >= 3
            ? [{ customer: { phone: { contains: search.replace(/\D/g, "") } } }]
            : []),
        ],
      });
    }
    const where: Prisma.ConversationWhereInput = extras.length ? { AND: [base, ...extras] } : base;

    const [items, total, counts] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          assignedMember: {
            select: { id: true, displayName: true, user: { select: { name: true } } },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { body: true, direction: true, createdAt: true },
          },
        },
      }),
      this.prisma.conversation.count({ where }),
      this.tabCounts(user.tenantId, actor),
    ]);

    return {
      tab,
      page,
      limit,
      total,
      counts,
      items: items.map((item) => ({
        id: item.id,
        protocol: item.protocol,
        status: item.status,
        version: item.version,
        unreadCount: item.unreadCount,
        lastMessageAt: item.lastMessageAt,
        customer: item.customer,
        assignee: item.assignedMember
          ? {
              id: item.assignedMember.id,
              name: item.assignedMember.displayName ?? item.assignedMember.user.name,
            }
          : null,
        lastMessage: item.messages[0]
          ? {
              preview: previewText(item.messages[0].body),
              direction: item.messages[0].direction,
              createdAt: item.messages[0].createdAt,
            }
          : null,
      })),
    };
  }

  private tabWhere(tenantId: string, actor: Actor, tab: InboxTab): Prisma.ConversationWhereInput {
    const active = { status: { in: [...ACTIVE_STATUSES] } };
    switch (tab) {
      case "queue":
        return { tenantId, ...active, assignedMemberId: null };
      case "mine":
        return { tenantId, ...active, assignedMemberId: actor.memberId };
      case "all":
        return { tenantId, ...active };
      case "closed":
        return {
          tenantId,
          status: "SOLVED",
          ...(isSupervisor(actor) ? {} : { assignedMemberId: actor.memberId }),
        };
    }
  }

  private async tabCounts(tenantId: string, actor: Actor) {
    const [queue, mine, closed, all] = await Promise.all([
      this.prisma.conversation.count({ where: this.tabWhere(tenantId, actor, "queue") }),
      this.prisma.conversation.count({ where: this.tabWhere(tenantId, actor, "mine") }),
      this.prisma.conversation.count({ where: this.tabWhere(tenantId, actor, "closed") }),
      isSupervisor(actor)
        ? this.prisma.conversation.count({ where: this.tabWhere(tenantId, actor, "all") })
        : Promise.resolve(null),
    ]);
    return { queue, mine, closed, all };
  }

  private async loadScoped(tx: Tx | PrismaClient, user: ServerAuthUser, id: string) {
    const conversation = await tx.conversation.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    const actor = actorFrom(user);
    if (!conversation || !canView(actor, conversation)) {
      throw new HttpError(404, "Conversa nao encontrada.");
    }
    return { conversation, actor };
  }

  async get(user: ServerAuthUser, id: string) {
    await this.assertUuid(id);
    const { conversation, actor } = await this.loadScoped(this.prisma, user, id);
    const [customer, messages, events, assignee] = await Promise.all([
      conversation.customerId
        ? this.prisma.customer.findFirst({
            where: { id: conversation.customerId, tenantId: user.tenantId },
            select: { id: true, name: true, phone: true, email: true, status: true },
          })
        : null,
      this.prisma.message.findMany({
        where: { tenantId: user.tenantId, conversationId: id },
        orderBy: { createdAt: "asc" },
        take: 300,
        select: {
          id: true,
          direction: true,
          senderType: true,
          body: true,
          senderMemberId: true,
          metadata: true,
          createdAt: true,
        },
      }),
      this.prisma.conversationEvent.findMany({
        where: { tenantId: user.tenantId, conversationId: id },
        orderBy: { createdAt: "asc" },
        take: 300,
      }),
      conversation.assignedMemberId
        ? this.prisma.tenantMember.findFirst({
            where: { id: conversation.assignedMemberId, tenantId: user.tenantId },
            select: { id: true, displayName: true, user: { select: { name: true } } },
          })
        : null,
    ]);

    const deliveries = await this.prisma.outboundDelivery.findMany({
      where: { tenantId: user.tenantId, conversationId: id },
      select: { messageId: true, status: true, attempts: true, lastError: true },
    });
    const deliveryByMessage = new Map(deliveries.map((d) => [d.messageId, d]));

    return {
      id: conversation.id,
      protocol: conversation.protocol,
      status: conversation.status,
      closeReason: conversation.closeReason,
      sectorId: conversation.sectorId,
      version: conversation.version,
      unreadCount: conversation.unreadCount,
      channelIntegrationId: conversation.channelIntegrationId,
      assignee: assignee
        ? { id: assignee.id, name: assignee.displayName ?? assignee.user.name }
        : null,
      customer,
      messages: messages.map((message) => ({
        ...message,
        delivery: deliveryByMessage.get(message.id) ?? null,
      })),
      events,
      can: {
        claim: canClaim(actor, conversation),
        reply: canReply(actor, conversation),
        transfer: canTransfer(actor, conversation),
        close: canClose(actor, conversation),
        reopen: canReopen(actor, conversation),
        assign: isSupervisor(actor) && conversation.status !== "SOLVED" && conversation.status !== "ARCHIVED",
      },
    };
  }

  private async assertUuid(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new HttpError(404, "Conversa nao encontrada.");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mutações (compare-and-set por version)                              */
  /* ------------------------------------------------------------------ */

  private async cas(
    tx: Tx,
    conversation: { id: string; tenantId: string; version: number },
    data: Prisma.ConversationUncheckedUpdateManyInput,
    extraWhere: Prisma.ConversationWhereInput = {},
  ) {
    const result = await tx.conversation.updateMany({
      where: {
        id: conversation.id,
        tenantId: conversation.tenantId,
        version: conversation.version,
        ...extraWhere,
      },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count !== 1) throw conflict();
  }

  private checkExpected(conversation: { version: number }, expectedVersion?: number) {
    if (expectedVersion !== undefined && expectedVersion !== conversation.version) {
      throw conflict();
    }
  }

  async claim(user: ServerAuthUser, id: string) {
    await this.assertUuid(id);
    const actor = actorFrom(user);
    requirePerm(actor, PERMISSIONS.reply);
    await this.prisma.$transaction(async (tx) => {
      const { conversation } = await this.loadScoped(tx, user, id);
      if (conversation.assignedMemberId) {
        throw conflict("Esta conversa ja foi assumida por outra pessoa.");
      }
      if (!canClaim(actor, conversation)) {
        throw new HttpError(409, "Conversa encerrada nao pode ser assumida.");
      }
      await this.cas(
        tx,
        conversation,
        { assignedMemberId: actor.memberId, claimedAt: new Date() },
        { assignedMemberId: null },
      );
      await this.logEvent(tx, user.tenantId, id, "CLAIMED", actor.memberId);
    });
    return this.get(user, id);
  }

  async transfer(
    user: ServerAuthUser,
    id: string,
    input: { toMemberId?: string; reason?: string; expectedVersion?: number },
  ) {
    await this.assertUuid(id);
    const actor = actorFrom(user);
    const toMemberId = String(input.toMemberId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(toMemberId)) throw new HttpError(422, "toMemberId invalido.");
    const reason = input.reason ? cleanText(input.reason, "reason", 1, 500) : null;

    await this.prisma.$transaction(async (tx) => {
      const { conversation } = await this.loadScoped(tx, user, id);
      if (!canTransfer(actor, conversation)) throw new HttpError(403, "Permissao insuficiente.");
      this.checkExpected(conversation, input.expectedVersion);
      if (conversation.assignedMemberId === toMemberId) {
        throw new HttpError(422, "A conversa ja esta com esta pessoa.");
      }

      const target = await tx.tenantMember.findFirst({
        where: { id: toMemberId, tenantId: user.tenantId, status: "ACTIVE" },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      });
      const targetCanReply = target?.role?.permissions.some(
        (item) => item.permission.code === PERMISSIONS.reply,
      );
      if (!target || !targetCanReply) {
        throw new HttpError(422, "Destino invalido: pessoa inexistente, inativa ou sem permissao de atendimento.");
      }

      await this.cas(tx, conversation, {
        assignedMemberId: toMemberId,
        claimedAt: new Date(),
        status: "OPEN",
      });
      await tx.conversationHandoff.create({
        data: {
          tenantId: user.tenantId,
          conversationId: id,
          requestedByMemberId: actor.memberId,
          fromMemberId: conversation.assignedMemberId,
          toMemberId,
          target: "USER",
          status: "COMPLETED",
          reason,
          resolvedAt: new Date(),
        },
      });
      await this.logEvent(tx, user.tenantId, id, "TRANSFERRED", actor.memberId, {
        from: conversation.assignedMemberId,
        to: toMemberId,
        reason,
      });
    });
    // Após transferir, quem transferiu pode perder a visibilidade (atendente sem chat.transfer).
    const updated = await this.prisma.conversation.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      select: { id: true, protocol: true, status: true, version: true, assignedMemberId: true },
    });
    return { ...updated, assigneeId: updated.assignedMemberId, stillVisible: canView(actor, updated) };
  }

  /** Atribuição pelo supervisor (fila ou troca de responsável). Mesmo CAS de transferência. */
  async assign(
    user: ServerAuthUser,
    id: string,
    input: { toMemberId?: string; reason?: string; expectedVersion?: number },
  ) {
    if (!isSupervisor(actorFrom(user))) throw new HttpError(403, "Permissao insuficiente.");
    return this.transfer(user, id, input);
  }

  async start(
    user: ServerAuthUser,
    input: { customerId?: string; contactName?: string; contactPhone?: string; text?: string; sectorId?: string; channelId?: string },
  ) {
    const actor = actorFrom(user);
    requirePerm(actor, PERMISSIONS.reply);
    const text = cleanText(input.text, "text", 1, 4000);
    const name = input.contactName ? cleanText(input.contactName, "contactName", 1, 160) : "Contato";
    const phone = input.contactPhone ? normalizePhone(input.contactPhone) : null;
    if (input.contactPhone && !phone) throw new HttpError(422, "contactPhone invalido.");
    const created = await this.prisma.$transaction(async (tx) => {
      let customerId = input.customerId;
      if (customerId) {
        const customer = await tx.customer.findFirst({ where: { id: customerId, tenantId: user.tenantId, deletedAt: null } });
        if (!customer) throw new HttpError(422, "Cliente invalido.");
      } else if (phone) {
        customerId = await this.resolveCustomer(tx, user.tenantId, phone, name);
      } else {
        throw new HttpError(422, "Informe o cliente ou um telefone.");
      }
      const protocol = await this.nextProtocol(tx, user.tenantId);
      const conversation = await tx.conversation.create({
        data: {
          tenantId: user.tenantId,
          customerId,
          protocol,
          status: "OPEN",
          assignedMemberId: actor.memberId,
          claimedAt: new Date(),
          lastMessageAt: new Date(),
          sectorId: input.sectorId,
          channelIntegrationId: input.channelId,
        },
      });
      await tx.message.create({
        data: {
          tenantId: user.tenantId,
          conversationId: conversation.id,
          senderType: "USER",
          direction: "OUTBOUND",
          contentType: "TEXT",
          body: text,
          senderMemberId: actor.memberId,
          sentAt: new Date(),
          metadata: { delivery: "RECORDED_ONLY", startedByAgent: true },
        },
      });
      await this.logEvent(tx, user.tenantId, conversation.id, "STARTED", actor.memberId);
      return conversation.id;
    });
    return this.get(user, created);
  }

  async close(
    user: ServerAuthUser,
    id: string,
    input: { reason?: string; expectedVersion?: number },
  ) {
    await this.assertUuid(id);
    const actor = actorFrom(user);
    const reasonCode = input.reason ? cleanText(input.reason, "reason", 1, 80) : null;
    if (reasonCode && !CLOSE_REASONS.some((item) => item.code === reasonCode) && reasonCode.length > 80) {
      throw new HttpError(422, "Motivo de encerramento invalido.");
    }
    await this.prisma.$transaction(async (tx) => {
      const { conversation } = await this.loadScoped(tx, user, id);
      if (!canClose(actor, conversation)) throw new HttpError(403, "Permissao insuficiente.");
      this.checkExpected(conversation, input.expectedVersion);
      if (conversation.sectorId) {
        const sector = await tx.sector.findFirst({ where: { id: conversation.sectorId, tenantId: user.tenantId } });
        if (sector?.requireCloseReason && !reasonCode) {
          throw new HttpError(422, "Informe o motivo de encerramento.");
        }
      }
      await this.cas(tx, conversation, {
        status: "SOLVED",
        closedAt: new Date(),
        closeReason: reasonCode,
        closedByMemberId: actor.memberId,
      });
      await this.logEvent(tx, user.tenantId, id, "CLOSED", actor.memberId, { reason: reasonCode });
    });
    return this.get(user, id);
  }

  async reopen(user: ServerAuthUser, id: string, input: { expectedVersion?: number }) {
    await this.assertUuid(id);
    const actor = actorFrom(user);
    await this.prisma.$transaction(async (tx) => {
      const { conversation } = await this.loadScoped(tx, user, id);
      if (!canReopen(actor, conversation)) throw new HttpError(403, "Permissao insuficiente.");
      this.checkExpected(conversation, input.expectedVersion);
      await this.cas(tx, conversation, { status: "OPEN", closedAt: null, closeReason: null });
      await this.logEvent(tx, user.tenantId, id, "REOPENED", actor.memberId);
    });
    return this.get(user, id);
  }

  /**
   * Registra a resposta. Com canal conectado, a entrega entra na caixa de saída na MESMA transação
   * (o worker envia depois); sem canal, a mensagem fica RECORDED_ONLY e nada é enviado a terceiros.
   */
  async reply(
    user: ServerAuthUser,
    id: string,
    input: { body?: string; internal?: boolean; clientMessageId?: string },
  ) {
    await this.assertUuid(id);
    const actor = actorFrom(user);
    const body = cleanText(input.body, "body", 1, 4000);
    const clientMessageId = cleanText(input.clientMessageId, "clientMessageId", 8, 100);
    const externalId = `out:${user.memberId}:${clientMessageId}`;
    const internal = input.internal === true;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { conversation } = await this.loadScoped(tx, user, id);
        if (!canReply(actor, conversation)) throw new HttpError(403, "Permissao insuficiente.");

        const message = await tx.message.create({
          data: {
            tenantId: user.tenantId,
            conversationId: id,
            senderType: "USER",
            direction: internal ? "INTERNAL" : "OUTBOUND",
            contentType: "TEXT",
            body,
            externalId,
            senderMemberId: actor.memberId,
            sentAt: new Date(),
            metadata: internal
              ? { internal: true }
              : { delivery: conversation.channelIntegrationId ? "PENDING" : "RECORDED_ONLY" },
          },
        });
        await tx.conversation.update({
          where: { id },
          data: {
            lastMessageAt: message.createdAt,
            unreadCount: 0,
            ...(internal || conversation.firstResponseAt ? {} : { firstResponseAt: message.createdAt }),
          },
        });
        if (!internal && conversation.channelIntegrationId) {
          await OutboxService.enqueue(tx, {
            tenantId: user.tenantId,
            messageId: message.id,
            conversationId: id,
            integrationId: conversation.channelIntegrationId,
          });
        }
        await publishEvent(tx, { type: "message.created", tenantId: user.tenantId, conversationId: id });
        return { id: message.id, duplicate: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.prisma.message.findFirst({
          where: { tenantId: user.tenantId, externalId, conversationId: id },
        });
        if (existing) return { id: existing.id, duplicate: true };
      }
      throw error;
    }
  }

  /** Reconciliação de uma entrega em estado UNKNOWN: reenviar ou marcar como não enviada. */
  async resolveDelivery(user: ServerAuthUser, id: string, messageId: string, action: string) {
    await this.assertUuid(id);
    if (action !== "retry" && action !== "mark_failed") throw new HttpError(422, "action invalida.");
    const { conversation } = await this.loadScoped(this.prisma, user, id);
    if (!canReply(actorFrom(user), conversation)) throw new HttpError(403, "Permissao insuficiente.");
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, tenantId: user.tenantId, conversationId: id },
      select: { id: true },
    });
    if (!message) throw new HttpError(404, "Mensagem nao encontrada.");
    const resolved = await new OutboxService(this.prisma).resolveUnknown(user.tenantId, message.id, action);
    if (!resolved) throw new HttpError(409, "A entrega nao esta em estado desconhecido.");
    return { ok: true };
  }

  async markRead(user: ServerAuthUser, id: string) {
    await this.assertUuid(id);
    const { conversation, actor } = await this.loadScoped(this.prisma, user, id);
    if (conversation.assignedMemberId !== actor.memberId) {
      throw new HttpError(403, "Somente quem atende pode marcar como lida.");
    }
    await this.prisma.conversation.updateMany({
      where: { id, tenantId: user.tenantId },
      data: { unreadCount: 0 },
    });
    return { ok: true };
  }

  /* ------------------------------------------------------------------ */
  /* Equipe e presença (M01)                                             */
  /* ------------------------------------------------------------------ */

  async listMembers(user: ServerAuthUser) {
    requirePerm(actorFrom(user), PERMISSIONS.read);
    const members = await this.prisma.tenantMember.findMany({
      where: {
        tenantId: user.tenantId,
        status: "ACTIVE",
        role: { permissions: { some: { permission: { code: PERMISSIONS.reply } } } },
      },
      include: { user: { select: { name: true } }, presence: true },
    });
    const now = new Date();
    return members
      .map((member) => ({
        id: member.id,
        name: member.displayName ?? member.user.name,
        presence: derivePresence(member.presence, now),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  /** Fonte canônica da presença: a escolha da pessoa (persistida) e o estado efetivo (com expiração do heartbeat). */
  async getPresence(user: ServerAuthUser) {
    const record = await this.prisma.teamPresence.findUnique({ where: { memberId: user.memberId } });
    const choice = (PRESENCE_STATUSES as readonly string[]).includes(record?.status ?? "")
      ? (record!.status as (typeof PRESENCE_STATUSES)[number])
      : "ONLINE";
    return { choice, effective: derivePresence(record), lastSeenAt: record?.lastSeenAt ?? null };
  }

  async heartbeat(user: ServerAuthUser, status: string) {
    if (!(PRESENCE_STATUSES as readonly string[]).includes(status)) {
      throw new HttpError(422, "status invalido.");
    }
    const now = new Date();
    const isOnline = status !== "OFFLINE";
    await this.prisma.teamPresence.upsert({
      where: { memberId: user.memberId },
      create: { tenantId: user.tenantId, memberId: user.memberId, isOnline, status, lastSeenAt: now },
      update: { isOnline, status, lastSeenAt: now },
    });
    await this.prisma.tenantMember.updateMany({
      where: { id: user.memberId, tenantId: user.tenantId },
      data: { lastSeenAt: now },
    });
    return { status, at: now.toISOString() };
  }
}

let singleton: InboxService | null = null;
export function getInboxService() {
  singleton ??= new InboxService();
  return singleton;
}
