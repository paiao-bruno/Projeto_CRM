import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "../prisma";
import { publishEvent } from "../realtime";
import { AdapterTimeoutError, getAdapter } from "./adapter";

export const DELIVERY_STATUSES = ["PENDING", "PROCESSING", "ACCEPTED", "DELIVERED", "READ", "FAILED", "UNKNOWN"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Progressão monotônica dos recibos: nunca regride (ex.: READ não volta a DELIVERED). */
const RECEIPT_RANK: Record<string, number> = { ACCEPTED: 1, DELIVERED: 2, READ: 3 };

export type ClaimedDelivery = {
  id: string;
  tenantId: string;
  messageId: string;
  conversationId: string;
  integrationId: string | null;
  attempts: number;
  maxAttempts: number;
  leaseToken: string;
};

export type OutboxOptions = {
  leaseMs: number;
  sendTimeoutMs: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
};

export const DEFAULT_OUTBOX_OPTIONS: OutboxOptions = {
  leaseMs: 60_000,
  sendTimeoutMs: 15_000,
  baseBackoffMs: 2_000,
  maxBackoffMs: 5 * 60_000,
};

export function backoffMs(attempt: number, options: OutboxOptions = DEFAULT_OUTBOX_OPTIONS) {
  return Math.min(options.maxBackoffMs, options.baseBackoffMs * 2 ** Math.max(0, attempt - 1));
}

export function sanitizeError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text.replace(/[A-Za-z0-9+/_=-]{24,}/g, "[redigido]").slice(0, 300);
}

export class OutboxService {
  constructor(
    private readonly prisma: PrismaClient = getPrisma(),
    private readonly options: OutboxOptions = DEFAULT_OUTBOX_OPTIONS,
  ) {}

  /** Chamado DENTRO da transação que cria a mensagem: sem janela entre "commit" e "enfileirar". */
  static async enqueue(
    tx: Prisma.TransactionClient,
    input: { tenantId: string; messageId: string; conversationId: string; integrationId: string },
  ) {
    return tx.outboundDelivery.create({ data: input });
  }

  /**
   * Reivindica entregas pendentes com FOR UPDATE SKIP LOCKED. Cada reivindicação recebe um
   * leaseToken novo (fencing): só quem tem o token vigente consegue concluir a entrega.
   */
  async claim(limit = 10, now: Date = new Date()): Promise<ClaimedDelivery[]> {
    const leaseExpiresAt = new Date(now.getTime() + this.options.leaseMs);
    return this.prisma.$queryRaw<ClaimedDelivery[]>(Prisma.sql`
      UPDATE "OutboundDelivery" d
         SET "status" = 'PROCESSING',
             "attempts" = d."attempts" + 1,
             "leaseToken" = gen_random_uuid()::text,
             "leaseExpiresAt" = ${leaseExpiresAt},
             "updatedAt" = ${now}
       WHERE d."id" IN (
         SELECT "id" FROM "OutboundDelivery"
          WHERE "status" = 'PENDING' AND "nextAttemptAt" <= ${now}
          ORDER BY "nextAttemptAt" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
      RETURNING d."id", d."tenantId", d."messageId", d."conversationId", d."integrationId",
                d."attempts", d."maxAttempts", d."leaseToken"`);
  }

  /**
   * Entregas cujo lease expirou: o envio pode ter sido aceito antes da falha do worker.
   * Sem idempotência garantida pelo provedor, o estado passa a UNKNOWN (reconciliação humana),
   * nunca a um reenvio cego.
   */
  async reapExpired(now: Date = new Date()) {
    const expired = await this.prisma.outboundDelivery.findMany({
      where: { status: "PROCESSING", leaseExpiresAt: { lt: now } },
      include: { integration: { select: { config: true } } },
      take: 100,
    });
    let requeued = 0;
    let unknown = 0;
    for (const delivery of expired) {
      const adapterKind = String((delivery.integration?.config as Record<string, unknown> | null)?.adapter ?? "");
      const adapter = getAdapter(adapterKind);
      const safeToRetry = Boolean(adapter?.idempotentByKey) && delivery.attempts < delivery.maxAttempts;
      const result = await this.prisma.outboundDelivery.updateMany({
        where: { id: delivery.id, status: "PROCESSING", leaseToken: delivery.leaseToken, leaseExpiresAt: { lt: now } },
        data: safeToRetry
          ? { status: "PENDING", leaseToken: null, leaseExpiresAt: null, nextAttemptAt: new Date(now.getTime() + backoffMs(delivery.attempts, this.options)) }
          : { status: "UNKNOWN", leaseToken: null, leaseExpiresAt: null, lastError: "Resultado desconhecido: o worker parou durante o envio." },
      });
      if (result.count === 1) {
        if (safeToRetry) requeued += 1;
        else {
          unknown += 1;
          await this.announce(delivery.tenantId, delivery.conversationId, delivery.messageId, "UNKNOWN");
        }
      }
    }
    return { requeued, unknown };
  }

  async process(claimed: ClaimedDelivery, now: () => Date = () => new Date()) {
    const delivery = await this.prisma.outboundDelivery.findUnique({
      where: { id: claimed.id },
      include: {
        message: true,
        integration: true,
        tenant: { select: { id: true } },
      },
    });
    if (!delivery || delivery.leaseToken !== claimed.leaseToken) return "stale" as const;

    const config = (delivery.integration?.config as Record<string, unknown> | null) ?? {};
    const adapter = delivery.integration && delivery.integration.status === "ACTIVE" ? getAdapter(String(config.adapter ?? "")) : null;
    if (!adapter) {
      return this.finish(claimed, now(), { status: "FAILED", lastError: "Conexão do canal inexistente, desativada ou sem adaptador." });
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: delivery.conversationId, tenantId: delivery.tenantId },
      select: { customer: { select: { phone: true, name: true } } },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.sendTimeoutMs);
    try {
      const result = await Promise.race([
        adapter.send(
          {
            idempotencyKey: delivery.messageId,
            deliveryId: delivery.id,
            tenantId: delivery.tenantId,
            conversationId: delivery.conversationId,
            to: { phone: conversation?.customer?.phone ?? null, name: conversation?.customer?.name ?? null },
            text: delivery.message.body ?? "",
          },
          config,
          controller.signal,
        ),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener("abort", () => reject(new AdapterTimeoutError()), { once: true }),
        ),
      ]);

      if (result.kind === "accepted") {
        return this.finish(claimed, now(), { status: "ACCEPTED", providerMessageId: result.providerMessageId, acceptedAt: now(), lastError: null });
      }
      const exhausted = claimed.attempts >= claimed.maxAttempts;
      if (result.retryable && !exhausted) {
        return this.finish(claimed, now(), {
          status: "PENDING",
          lastError: sanitizeError(result.reason),
          nextAttemptAt: new Date(now().getTime() + backoffMs(claimed.attempts, this.options)),
        });
      }
      return this.finish(claimed, now(), { status: "FAILED", lastError: sanitizeError(result.reason) });
    } catch (error) {
      // Exceção ou timeout depois de iniciar o envio: o provedor pode ter aceitado. Não reenviar às cegas.
      return this.finish(claimed, now(), { status: "UNKNOWN", lastError: sanitizeError(error) });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Conclusão protegida por fencing: só o detentor do leaseToken vigente altera o estado. */
  private async finish(
    claimed: ClaimedDelivery,
    at: Date,
    patch: {
      status: DeliveryStatus;
      lastError?: string | null;
      providerMessageId?: string;
      acceptedAt?: Date;
      nextAttemptAt?: Date;
    },
  ) {
    const updated = await this.prisma.outboundDelivery.updateMany({
      where: { id: claimed.id, leaseToken: claimed.leaseToken, status: "PROCESSING" },
      data: { ...patch, leaseToken: null, leaseExpiresAt: null, updatedAt: at },
    });
    if (updated.count === 0) return "stale" as const;
    await this.syncMessage(claimed.tenantId, claimed.messageId, patch.status, patch.lastError ?? null);
    await this.announce(claimed.tenantId, claimed.conversationId, claimed.messageId, patch.status);
    return patch.status;
  }

  private async syncMessage(tenantId: string, messageId: string, status: DeliveryStatus, error: string | null) {
    const message = await this.prisma.message.findFirst({ where: { id: messageId, tenantId }, select: { metadata: true } });
    const metadata = { ...((message?.metadata as Record<string, unknown> | null) ?? {}), delivery: status, deliveryError: error };
    await this.prisma.message.updateMany({
      where: { id: messageId, tenantId },
      data: {
        metadata: metadata as Prisma.InputJsonValue,
        ...(status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
        ...(status === "READ" ? { readAt: new Date() } : {}),
      },
    });
  }

  private async announce(tenantId: string, conversationId: string, messageId: string, status: string) {
    await this.prisma.$transaction(async (tx) => {
      await publishEvent(tx, { type: `delivery.${status.toLowerCase()}`, tenantId, conversationId });
    });
    void messageId;
  }

  /**
   * Recibo do provedor (delivered/read/failed). Idempotente e monotônico; só atua em entregas
   * da própria conexão autenticada (tenant e integração vêm do contexto, nunca do corpo).
   */
  async applyReceipt(tenantId: string, integrationId: string, providerMessageId: string, status: "ACCEPTED" | "DELIVERED" | "READ" | "FAILED") {
    const delivery = await this.prisma.outboundDelivery.findFirst({
      where: { tenantId, integrationId, providerMessageId },
    });
    if (!delivery) return { applied: false as const, reason: "not_found" };
    if (status === "FAILED") {
      if (["DELIVERED", "READ"].includes(delivery.status)) return { applied: false as const, reason: "already_final" };
    } else if ((RECEIPT_RANK[status] ?? 0) <= (RECEIPT_RANK[delivery.status] ?? 0)) {
      return { applied: false as const, reason: "no_progress" };
    }
    const updated = await this.prisma.outboundDelivery.updateMany({
      where: { id: delivery.id, status: delivery.status },
      data: { status, lastError: status === "FAILED" ? "Falha informada pelo provedor." : null },
    });
    if (updated.count === 0) return { applied: false as const, reason: "raced" };
    await this.syncMessage(tenantId, delivery.messageId, status, status === "FAILED" ? "Falha informada pelo provedor." : null);
    await this.announce(tenantId, delivery.conversationId, delivery.messageId, status);
    return { applied: true as const };
  }

  /** Reconciliação humana de entrega UNKNOWN: reenviar (aceitando risco de duplicidade) ou marcar como não enviada. */
  async resolveUnknown(tenantId: string, messageId: string, action: "retry" | "mark_failed") {
    const data =
      action === "retry"
        ? { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null }
        : { status: "FAILED", lastError: "Marcada como não enviada após conferência manual." };
    const result = await this.prisma.outboundDelivery.updateMany({
      where: { tenantId, messageId, status: "UNKNOWN" },
      data,
    });
    if (result.count === 0) return false;
    const delivery = await this.prisma.outboundDelivery.findFirst({ where: { tenantId, messageId } });
    if (delivery) {
      await this.syncMessage(tenantId, messageId, data.status as DeliveryStatus, data.lastError);
      await this.announce(tenantId, delivery.conversationId, messageId, data.status);
    }
    return true;
  }

  async runOnce(limit = 10, now: Date = new Date()) {
    await this.reapExpired(now);
    const claimed = await this.claim(limit, now);
    const outcomes: string[] = [];
    for (const delivery of claimed) outcomes.push(await this.process(delivery));
    return { claimed: claimed.length, outcomes };
  }

  async heartbeat(name: string, info: Prisma.InputJsonValue) {
    await this.prisma.workerHeartbeat.upsert({
      where: { name },
      create: { name, info },
      update: { lastSeenAt: new Date(), info },
    });
  }
}

export function newWorkerId() {
  return `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
}
