import { Prisma, type PrismaClient } from "@prisma/client";
import type { ServerAuthUser } from "./auth";
import { recordAudit } from "./audit";
import { HttpError } from "./http";
import { getPrisma } from "./prisma";
import { optionalEnum, optionalString, requireUuid, requiredString, stripUndefined, type Body } from "./validation";

const PROVIDERS = ["OPENAI", "CLAUDE", "GEMINI"] as const;

function numberField(body: Body, field: string, min: number, max: number) {
  if (body[field] === undefined || body[field] === null) return undefined;
  const value = Number(body[field]);
  if (!Number.isFinite(value) || value < min || value > max) throw new HttpError(422, `${field} deve estar entre ${min} e ${max}.`);
  return value;
}

/** Configuração de agentes de IA persistida localmente. Nenhuma chamada a provedor de IA é feita aqui. */
export class AiAgentsService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  list(user: ServerAuthUser) {
    return this.prisma.aiAgent.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
  }

  async get(user: ServerAuthUser, id: string) {
    const agent = await this.prisma.aiAgent.findFirst({ where: { id: requireUuid(id), tenantId: user.tenantId } });
    if (!agent) throw new HttpError(404, "Agente não encontrado.");
    return agent;
  }

  async create(user: ServerAuthUser, body: Body) {
    const provider = optionalEnum(body, "provider", PROVIDERS);
    if (!provider) throw new HttpError(422, `provider deve ser um de: ${PROVIDERS.join(", ")}.`);
    const maxTokens = numberField(body, "maxTokens", 1, 200_000);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const agent = await tx.aiAgent.create({
          data: {
            tenantId: user.tenantId,
            name: requiredString(body, "name", 120),
            description: optionalString(body, "description", 1000) ?? undefined,
            provider,
            model: requiredString(body, "model", 120),
            systemPrompt: requiredString(body, "systemPrompt", 20_000),
            temperature: numberField(body, "temperature", 0, 2)?.toFixed(2),
            maxTokens: maxTokens === undefined ? undefined : Math.floor(maxTokens),
            isDefault: body.isDefault === true,
            status: "ACTIVE",
          },
        });
        await recordAudit(tx, user, "ai_agent.created", "AiAgent", agent.id);
        return agent;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "Já existe um agente com este nome.");
      }
      throw error;
    }
  }

  async update(user: ServerAuthUser, id: string, body: Body) {
    await this.get(user, id);
    const temperature = numberField(body, "temperature", 0, 2);
    const maxTokens = numberField(body, "maxTokens", 1, 200_000);
    const data = stripUndefined({
      name: body.name === undefined ? undefined : requiredString(body, "name", 120),
      description: optionalString(body, "description", 1000),
      provider: optionalEnum(body, "provider", PROVIDERS),
      model: body.model === undefined ? undefined : requiredString(body, "model", 120),
      systemPrompt: body.systemPrompt === undefined ? undefined : requiredString(body, "systemPrompt", 20_000),
      temperature: temperature === undefined ? undefined : temperature.toFixed(2),
      maxTokens: maxTokens === undefined ? undefined : Math.floor(maxTokens),
      isDefault: typeof body.isDefault === "boolean" ? body.isDefault : undefined,
    });
    return this.prisma.$transaction(async (tx) => {
      const agent = await tx.aiAgent.update({ where: { id }, data });
      await recordAudit(tx, user, "ai_agent.updated", "AiAgent", id, { fields: Object.keys(data) });
      return agent;
    });
  }

  async toggle(user: ServerAuthUser, id: string) {
    const agent = await this.get(user, id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.aiAgent.update({
        where: { id },
        data: { status: agent.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" },
      });
      await recordAudit(tx, user, "ai_agent.toggled", "AiAgent", id, { status: updated.status });
      return updated;
    });
  }

  async remove(user: ServerAuthUser, id: string) {
    await this.get(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.aiAgent.delete({ where: { id } });
      await recordAudit(tx, user, "ai_agent.deleted", "AiAgent", id);
    });
    return { deleted: true, id };
  }
}

let singleton: AiAgentsService | null = null;
export function getAiAgentsService() {
  singleton ??= new AiAgentsService();
  return singleton;
}
