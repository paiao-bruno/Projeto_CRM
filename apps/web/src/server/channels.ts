import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ServerAuthUser } from "./auth";
import { recordAudit } from "./audit";
import { HttpError } from "./http";
import { SUPPORTED_ADAPTERS } from "./outbox/adapter";
import { getPrisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./secret-box";
import { optionalEnum, requireUuid, requiredString, type Body } from "./validation";

const BEHAVIORS = ["accept", "reject_retryable", "reject_permanent", "timeout", "throw"] as const;
const STATUSES = ["ACTIVE", "DISABLED"] as const;

export type ChannelView = {
  id: string;
  name: string;
  status: string;
  adapter: string;
  behavior: string | null;
  webhookPath: string;
  secretFingerprint: string | null;
  lastInboundAt: string | null;
  deliveries: Record<string, number>;
};

function newSecret() {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

function fingerprint(secret: string) {
  return createHash("sha256").update(secret).digest("hex").slice(0, 8);
}

/** Conexões de canal (provedor WEBHOOK). Credenciais de integrações descontinuadas não são expostas nem usadas. */
export class ChannelsService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  private view(row: { id: string; name: string; status: string; config: Prisma.JsonValue; lastConnectedAt: Date | null }, deliveries: Record<string, number>): ChannelView {
    const config = (row.config as Record<string, unknown> | null) ?? {};
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      adapter: String(config.adapter ?? ""),
      behavior: typeof config.behavior === "string" ? config.behavior : null,
      webhookPath: `/api/webhooks/inbound/${row.id}`,
      secretFingerprint: typeof config.secretFingerprint === "string" ? config.secretFingerprint : null,
      lastInboundAt: row.lastConnectedAt?.toISOString() ?? null,
      deliveries,
    };
  }

  async list(user: ServerAuthUser): Promise<ChannelView[]> {
    const rows = await this.prisma.integration.findMany({
      where: { tenantId: user.tenantId, provider: "WEBHOOK" },
      orderBy: { createdAt: "asc" },
    });
    const counts = await this.prisma.outboundDelivery.groupBy({
      by: ["integrationId", "status"],
      where: { tenantId: user.tenantId, integrationId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    return rows.map((row) =>
      this.view(
        row,
        Object.fromEntries(counts.filter((c) => c.integrationId === row.id).map((c) => [c.status, c._count._all])),
      ),
    );
  }

  private async get(user: ServerAuthUser, id: string) {
    const row = await this.prisma.integration.findFirst({
      where: { id: requireUuid(id), tenantId: user.tenantId, provider: "WEBHOOK" },
    });
    if (!row) throw new HttpError(404, "Conexão não encontrada.");
    return row;
  }

  async create(user: ServerAuthUser, body: Body) {
    const name = requiredString(body, "name", 80);
    const adapter = optionalEnum(body, "adapter", SUPPORTED_ADAPTERS) ?? "test";
    const behavior = optionalEnum(body, "behavior", BEHAVIORS) ?? "accept";
    const secret = newSecret();
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.integration.create({
          data: {
            tenantId: user.tenantId,
            provider: "WEBHOOK",
            name,
            status: "ACTIVE",
            healthStatus: "UNKNOWN",
            config: { adapter, behavior, secretFingerprint: fingerprint(secret) },
            encryptedSecrets: encryptSecret(JSON.stringify({ webhookSecret: secret })),
          },
        });
        await recordAudit(tx, user, "channel.created", "Integration", created.id, { adapter });
        return created;
      });
      return { ...this.view(row, {}), secret };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "Já existe uma conexão com este nome.");
      }
      throw error;
    }
  }

  async update(user: ServerAuthUser, id: string, body: Body) {
    const row = await this.get(user, id);
    const status = optionalEnum(body, "status", STATUSES);
    const behavior = optionalEnum(body, "behavior", BEHAVIORS);
    const name = body.name === undefined ? undefined : requiredString(body, "name", 80);
    const config = { ...((row.config as Record<string, unknown> | null) ?? {}), ...(behavior ? { behavior } : {}) };
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.integration.update({
        where: { id },
        data: { ...(status ? { status } : {}), ...(name ? { name } : {}), config: config as Prisma.InputJsonValue },
      });
      await recordAudit(tx, user, "channel.updated", "Integration", id, { status, behavior });
      return result;
    });
    return this.view(updated, {});
  }

  async rotateSecret(user: ServerAuthUser, id: string) {
    const row = await this.get(user, id);
    const secret = newSecret();
    const config = { ...((row.config as Record<string, unknown> | null) ?? {}), secretFingerprint: fingerprint(secret) };
    await this.prisma.$transaction(async (tx) => {
      await tx.integration.update({
        where: { id },
        data: { encryptedSecrets: encryptSecret(JSON.stringify({ webhookSecret: secret })), config: config as Prisma.InputJsonValue },
      });
      await recordAudit(tx, user, "channel.secret_rotated", "Integration", id);
    });
    return { id, secret, secretFingerprint: fingerprint(secret) };
  }

  async deliveries(user: ServerAuthUser, query: URLSearchParams) {
    const limit = Math.min(100, Math.max(1, Number(query.get("limit")) || 30));
    const rows = await this.prisma.outboundDelivery.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true, messageId: true, conversationId: true, integrationId: true, status: true,
        attempts: true, maxAttempts: true, lastError: true, createdAt: true, updatedAt: true,
      },
    });
    const heartbeat = await this.prisma.workerHeartbeat.findUnique({ where: { name: "outbox" } });
    const workerAlive = Boolean(heartbeat && Date.now() - heartbeat.lastSeenAt.getTime() < 30_000);
    return { items: rows, worker: { alive: workerAlive, lastSeenAt: heartbeat?.lastSeenAt.toISOString() ?? null } };
  }

  /** Resolve a conexão a partir do id da URL; devolve o segredo apenas para uso interno na verificação HMAC. */
  async loadForWebhook(integrationId: string): Promise<{ tenantId: string; integrationId: string; secret: string } | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(integrationId)) return null;
    const row = await this.prisma.integration.findFirst({ where: { id: integrationId, provider: "WEBHOOK", status: "ACTIVE" } });
    if (!row?.encryptedSecrets) return null;
    try {
      const secret = (JSON.parse(decryptSecret(row.encryptedSecrets)) as { webhookSecret?: string }).webhookSecret;
      return secret ? { tenantId: row.tenantId, integrationId: row.id, secret } : null;
    } catch {
      return null;
    }
  }

  async touchInbound(integrationId: string) {
    await this.prisma.integration.updateMany({
      where: { id: integrationId },
      data: { lastConnectedAt: new Date(), healthStatus: "HEALTHY" },
    });
  }
}

let singleton: ChannelsService | null = null;
export function getChannelsService() {
  singleton ??= new ChannelsService();
  return singleton;
}
