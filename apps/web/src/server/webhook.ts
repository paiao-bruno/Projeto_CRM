import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ChannelsService } from "./channels";
import { HttpError } from "./http";
import { InboxService } from "./inbox/service";
import { OutboxService } from "./outbox/service";
import { getPrisma } from "./prisma";

/**
 * Contrato de webhook de entrada "Vértice v1".
 *
 *   POST /api/webhooks/inbound/<connectionId>
 *   X-Vertice-Timestamp: <segundos unix>
 *   X-Vertice-Signature: v1=<hex(HMAC-SHA256(segredo, "<timestamp>." + corpoBruto))>
 *
 * A organização e a conexão vêm da conexão autenticada (id na URL + assinatura válida), nunca do corpo.
 */
export const MAX_BODY_BYTES = 256 * 1024;
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, timestamp: string, rawBody: Uint8Array): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
  return `v1=${digest}`;
}

export function verifySignature(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: Uint8Array;
  nowMs?: number;
}): { ok: true } | { ok: false; reason: "missing_headers" | "stale_timestamp" | "bad_signature" } {
  const { secret, timestamp, signature, rawBody } = input;
  if (!timestamp || !signature) return { ok: false, reason: "missing_headers" };
  if (!/^\d{10,13}$/.test(timestamp)) return { ok: false, reason: "stale_timestamp" };
  const seconds = timestamp.length > 10 ? Math.floor(Number(timestamp) / 1000) : Number(timestamp);
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - seconds) > TIMESTAMP_TOLERANCE_SECONDS) return { ok: false, reason: "stale_timestamp" };
  const expected = Buffer.from(signPayload(secret, timestamp, rawBody));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}

type Parsed =
  | { type: "message.received"; eventId: string; contactName: string; contactPhone: string; text: string; occurredAt?: string }
  | { type: "message.status"; eventId: string; providerMessageId: string; status: "ACCEPTED" | "DELIVERED" | "READ" | "FAILED" };

function str(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) {
    throw new HttpError(422, `${field} inválido.`);
  }
  return value.trim();
}

export function parseWebhookPayload(json: unknown): Parsed {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new HttpError(422, "Payload inválido.");
  const body = json as Record<string, unknown>;
  const eventId = str(body.eventId, "eventId", 1, 128);
  if (body.type === "message.received") {
    const contact = (body.contact ?? {}) as Record<string, unknown>;
    const message = (body.message ?? {}) as Record<string, unknown>;
    const occurredAt = body.occurredAt === undefined ? undefined : str(body.occurredAt, "occurredAt", 1, 40);
    if (occurredAt && Number.isNaN(new Date(occurredAt).getTime())) throw new HttpError(422, "occurredAt inválido.");
    return {
      type: "message.received",
      eventId,
      contactPhone: str(contact.phone, "contact.phone", 6, 40),
      contactName: typeof contact.name === "string" && contact.name.trim() ? str(contact.name, "contact.name", 1, 160) : "Contato sem nome",
      text: str(message.text, "message.text", 1, 4000),
      occurredAt,
    };
  }
  if (body.type === "message.status") {
    const status = String(body.status ?? "").toUpperCase();
    if (!["ACCEPTED", "DELIVERED", "READ", "FAILED"].includes(status)) throw new HttpError(422, "status inválido.");
    return {
      type: "message.status",
      eventId,
      providerMessageId: str(body.providerMessageId, "providerMessageId", 1, 200),
      status: status as "ACCEPTED" | "DELIVERED" | "READ" | "FAILED",
    };
  }
  throw new HttpError(422, "type não suportado.");
}

export class WebhookService {
  constructor(
    private readonly channels: Pick<ChannelsService, "loadForWebhook" | "touchInbound">,
    private readonly prisma: PrismaClient = getPrisma(),
    private readonly inbox: InboxService = new InboxService(prisma),
    private readonly outbox: OutboxService = new OutboxService(prisma),
    private readonly log: (event: string, fields: Record<string, string>) => void = (event, fields) =>
      console.warn(`[webhook] ${event} ${JSON.stringify(fields)}`),
  ) {}

  async handle(input: { integrationId: string; headers: Pick<Headers, "get">; rawBody: Uint8Array; nowMs?: number }) {
    const connection = await this.channels.loadForWebhook(input.integrationId);
    // Mesma resposta para conexão inexistente, desativada ou assinatura inválida (sem enumeração).
    const unauthorized = new HttpError(401, "Assinatura inválida.");
    if (!connection) {
      this.log("rejected", { reason: "unknown_connection" });
      throw unauthorized;
    }
    const verified = verifySignature({
      secret: connection.secret,
      timestamp: input.headers.get("x-vertice-timestamp"),
      signature: input.headers.get("x-vertice-signature"),
      rawBody: input.rawBody,
      nowMs: input.nowMs,
    });
    if (!verified.ok) {
      this.log("rejected", { reason: verified.reason, connection: connection.integrationId });
      throw unauthorized;
    }

    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(input.rawBody).toString("utf8"));
    } catch {
      throw new HttpError(400, "JSON inválido.");
    }
    const event = parseWebhookPayload(json);
    const provider = `wh-${connection.integrationId}`;

    if (event.type === "message.received") {
      const result = await this.inbox.ingestInbound(connection.tenantId, {
        provider,
        providerEventId: event.eventId,
        contactName: event.contactName,
        contactPhone: event.contactPhone,
        text: event.text,
        occurredAt: event.occurredAt,
        channelIntegrationId: connection.integrationId,
      });
      if (result.duplicate && result.payloadMismatch) {
        throw new HttpError(409, "eventId já utilizado com conteúdo diferente.");
      }
      await this.channels.touchInbound(connection.integrationId);
      return { status: result.duplicate ? ("duplicate" as const) : ("accepted" as const) };
    }

    // Recibo de entrega: o mesmo eventId nunca é aplicado duas vezes.
    const inserted = await this.prisma.inboundEvent.createMany({
      data: [{ tenantId: connection.tenantId, provider, providerEventId: event.eventId, payloadHash: `status:${event.providerMessageId}:${event.status}` }],
      skipDuplicates: true,
    });
    if (inserted.count === 0) return { status: "duplicate" as const };
    const applied = await this.outbox.applyReceipt(connection.tenantId, connection.integrationId, event.providerMessageId, event.status);
    await this.channels.touchInbound(connection.integrationId);
    return { status: applied.applied ? ("accepted" as const) : ("ignored" as const) };
  }
}
