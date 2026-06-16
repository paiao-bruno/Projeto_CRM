import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { CreateAiAgentDto } from "./dto/create-ai-agent.dto";
import { UpdateAiAgentDto } from "./dto/update-ai-agent.dto";

@Injectable()
export class AiAgentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.aiAgent.findMany({
      where: { tenantId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
  }

  async get(tenantId: string, id: string) {
    const agent = await this.prisma.aiAgent.findFirst({
      where: { tenantId, id },
    });

    if (!agent) {
      throw new NotFoundException("Agente nao encontrado.");
    }

    return agent;
  }

  create(tenantId: string, dto: CreateAiAgentDto) {
    return this.prisma.aiAgent.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        provider: dto.provider,
        model: dto.model,
        systemPrompt: dto.systemPrompt,
        temperature: dto.temperature?.toString(),
        maxTokens: dto.maxTokens,
        isDefault: dto.isDefault ?? false,
        status: "ACTIVE",
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateAiAgentDto) {
    await this.get(tenantId, id);

    return this.prisma.aiAgent.update({
      where: { id },
      data: {
        ...dto,
        temperature: dto.temperature?.toString(),
      },
    });
  }

  async toggle(tenantId: string, id: string) {
    const agent = await this.get(tenantId, id);

    return this.prisma.aiAgent.update({
      where: { id },
      data: {
        status: agent.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);

    return this.prisma.aiAgent.delete({
      where: { id },
    });
  }
}
