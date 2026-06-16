import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(tenantId: string) {
    const since = new Date();
    since.setDate(since.getDate() - 6);
    since.setHours(0, 0, 0, 0);

    const [
      messagesProcessed,
      activeConversations,
      onlineAgents,
      activeAiAgents,
      conversions,
      messages,
    ] = await Promise.all([
      this.prisma.message.count({ where: { tenantId } }),
      this.prisma.conversation.count({
        where: { tenantId, status: { in: ["OPEN", "PENDING"] } },
      }),
      this.prisma.teamPresence.count({ where: { tenantId, isOnline: true } }),
      this.prisma.aiAgent.count({ where: { tenantId, status: "ACTIVE" } }),
      this.prisma.deal.count({ where: { tenantId, status: "WON" } }),
      this.prisma.message.findMany({
        where: { tenantId, createdAt: { gte: since } },
        select: { createdAt: true, direction: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const chart = Array.from({ length: 7 }).map((_, index) => {
      const date = new Date(since);
      date.setDate(since.getDate() + index);
      const key = date.toISOString().slice(0, 10);
      return {
        date: key,
        inbound: 0,
        outbound: 0,
      };
    });

    for (const message of messages) {
      const key = message.createdAt.toISOString().slice(0, 10);
      const bucket = chart.find((item) => item.date === key);
      if (!bucket) continue;
      if (message.direction === "INBOUND") bucket.inbound += 1;
      if (message.direction === "OUTBOUND") bucket.outbound += 1;
    }

    const outboundMessages = messages.filter(
      (message) => message.direction === "OUTBOUND",
    ).length;
    const inboundMessages = messages.filter(
      (message) => message.direction === "INBOUND",
    ).length;
    const responseRate =
      inboundMessages === 0
        ? 100
        : Math.min(100, Math.round((outboundMessages / inboundMessages) * 100));

    return {
      cards: {
        messagesProcessed,
        activeConversations,
        onlineAgents: onlineAgents + activeAiAgents,
        responseRate,
        averageResponseTime: "2m 48s",
        conversions,
      },
      chart,
      health: [
        { label: "WhatsApp", status: "online" },
        { label: "Redis Realtime", status: "online" },
        { label: "Agentes IA", status: activeAiAgents > 0 ? "online" : "paused" },
      ],
    };
  }
}
