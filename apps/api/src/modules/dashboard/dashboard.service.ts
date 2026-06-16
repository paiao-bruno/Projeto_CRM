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
      allMessages,
      agentMessages,
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
      this.prisma.message.findMany({
        where: { tenantId },
        select: { direction: true },
      }),
      this.prisma.message.findMany({
        where: {
          tenantId,
          senderType: { in: ["USER", "AI_AGENT"] },
        },
        select: {
          senderType: true,
          senderMember: {
            select: {
              user: { select: { name: true } },
            },
          },
          senderAiAgent: {
            select: { name: true },
          },
        },
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
    const channelDistribution = this.buildChannelDistribution(allMessages);
    const agentPerformance = this.buildAgentPerformance(agentMessages);

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
      channelDistribution,
      agentPerformance,
      health: [
        { label: "WhatsApp", status: "online" },
        { label: "Redis Realtime", status: "online" },
        { label: "Agentes IA", status: activeAiAgents > 0 ? "online" : "paused" },
      ],
    };
  }

  private buildChannelDistribution(messages: Array<{ direction: string }>) {
    const whatsapp = messages.filter(
      (message) => message.direction === "INBOUND",
    ).length;
    const internal = messages.length - whatsapp;
    const total = Math.max(whatsapp + internal, 1);

    return [
      {
        name: "Internal",
        value: internal,
        percentage: Math.round((internal / total) * 100),
        color: "#8b8cf6",
      },
      {
        name: "WhatsApp",
        value: whatsapp,
        percentage: Math.round((whatsapp / total) * 100),
        color: "#34d399",
      },
    ];
  }

  private buildAgentPerformance(
    messages: Array<{
      senderType: string;
      senderMember: { user: { name: string } } | null;
      senderAiAgent: { name: string } | null;
    }>,
  ) {
    const counts = new Map<string, number>();

    for (const message of messages) {
      const name =
        message.senderType === "AI_AGENT"
          ? (message.senderAiAgent?.name ?? "IA")
          : (message.senderMember?.user.name ?? "Atendente");
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    const palette = ["#38bdf8", "#a78bfa", "#fb7185", "#2dd4bf", "#fbbf24"];

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, messagesProcessed], index) => ({
        name,
        messagesProcessed,
        color: palette[index % palette.length],
      }));
  }
}
