import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  listConversations(tenantId: string) {
    return this.prisma.conversation.findMany({
      where: { tenantId },
      include: {
        customer: true,
        assignedMember: { include: { user: true } },
        activeAiAgent: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take: 50,
    });
  }

  async getConversation(tenantId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { tenantId, id: conversationId },
      include: {
        customer: true,
        assignedMember: { include: { user: true } },
        activeAiAgent: true,
        messages: {
          include: {
            senderMember: { include: { user: true } },
            senderCustomer: true,
            senderAiAgent: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException("Conversa nao encontrada.");
    }

    return conversation;
  }

  async sendMessage(tenantId: string, memberId: string, conversationId: string, body: string) {
    await this.getConversation(tenantId, conversationId);

    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId,
        senderType: "USER",
        direction: "OUTBOUND",
        contentType: "TEXT",
        senderMemberId: memberId,
        body,
        sentAt: new Date(),
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: "OPEN",
        lastMessageAt: new Date(),
      },
    });

    return message;
  }
}
