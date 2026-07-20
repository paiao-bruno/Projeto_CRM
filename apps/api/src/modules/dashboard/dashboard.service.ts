import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { DashboardSgpSyncService } from "./dashboard-sgp-sync.service";

type MemorySourceKey =
  | "DOCUMENT_PROCESSED"
  | "TRAINING_COMPLETED"
  | "CONVERSATION_USEFUL"
  | "KNOWLEDGE_ADDED"
  | "FAQ_CREATED"
  | "INTEGRATION_SYNC";

@Injectable()
export class DashboardService {
  private readonly agentMemoryCache = new Map<
    string,
    { expiresAt: number; value: Awaited<ReturnType<DashboardService["getAgentMemoryOverview"]>> }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sgpSyncDashboard: DashboardSgpSyncService,
  ) {}

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
      activeContracts,
      overdueInvoices,
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
      this.prisma.contract.count({ where: { tenantId, status: "ACTIVE", deletedAt: null } }),
      this.prisma.invoice.count({ where: { tenantId, status: "OVERDUE", deletedAt: null } }),
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
    const agentMemory = await this.getCachedAgentMemoryOverview(tenantId);
    const sgpSync = await this.sgpSyncDashboard.getOverview(tenantId);

    return {
      cards: {
        messagesProcessed,
        activeConversations,
        onlineAgents: onlineAgents + activeAiAgents,
        responseRate,
        averageResponseTime: "2m 48s",
        conversions,
        activeContracts,
        overdueInvoices,
      },
      chart,
      channelDistribution,
      agentPerformance,
      agentMemory,
      sgpSync,
      health: [
        { label: "WhatsApp", status: "online" },
        { label: "Redis Realtime", status: "online" },
        { label: "Agentes IA", status: activeAiAgents > 0 ? "online" : "paused" },
        {
          label: "SGP Sync",
          status: sgpSync.runningSync
            ? "syncing"
            : sgpSync.lastSync?.status === "COMPLETED"
              ? "online"
              : sgpSync.lastSync?.status === "FAILED"
                ? "error"
                : "paused",
        },
      ],
    };
  }

  private async getCachedAgentMemoryOverview(tenantId: string) {
    const cacheKey = `agent-memory:${tenantId}`;
    const cached = this.agentMemoryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value = await this.getAgentMemoryOverview(tenantId);
    this.agentMemoryCache.set(cacheKey, {
      expiresAt: Date.now() + 15_000,
      value,
    });
    return value;
  }

  private async getAgentMemoryOverview(tenantId: string) {
    const agents = await this.prisma.aiAgent.findMany({
      where: { tenantId },
      include: {
        knowledgeBases: true,
        memory: true,
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      take: 50,
    });

    const syncedAgents = await Promise.all(
      agents.map(async (agent) => {
        const knowledgeBaseIds = agent.knowledgeBases.map(
          (knowledgeBase) => knowledgeBase.knowledgeBaseId,
        );
        const sourceTotals = await this.calculateAgentMemorySources(
          tenantId,
          agent.id,
          knowledgeBaseIds,
        );
        const learnedMemories = Object.values(sourceTotals).reduce(
          (total, value) => total + value,
          0,
        );
        const totalMemories = Math.max(agent.memory?.totalMemories ?? 100, 100);
        const cappedLearnedMemories = Math.min(learnedMemories, totalMemories);
        const learningPercentage = Math.round(
          (cappedLearnedMemories / totalMemories) * 100,
        );
        const level = this.getMemoryLevel(learningPercentage);
        const memory = await this.upsertAgentMemory({
          tenantId,
          agentId: agent.id,
          existing: agent.memory,
          learnedMemories: cappedLearnedMemories,
          totalMemories,
          learningPercentage,
          level,
        });

        await this.recordMemoryHistoryDeltas({
          tenantId,
          agentId: agent.id,
          sourceTotals,
        });

        const [today, week, month, previousWeek] = await Promise.all([
          this.sumMemoriesSince(tenantId, agent.id, this.startOfDay(0)),
          this.sumMemoriesSince(tenantId, agent.id, this.startOfDay(6)),
          this.sumMemoriesSince(tenantId, agent.id, this.startOfDay(29)),
          this.sumMemoriesBetween(
            tenantId,
            agent.id,
            this.startOfDay(13),
            this.startOfDay(7),
          ),
        ]);

        const growthRate =
          previousWeek === 0
            ? week > 0
              ? 100
              : 0
            : Math.round(((week - previousWeek) / previousWeek) * 100);

        return {
          id: agent.id,
          name: agent.name,
          function: this.getMemoryLevelLabel(level),
          status: agent.status,
          learnedMemories: memory.learnedMemories,
          totalMemories: memory.totalMemories,
          remainingMemories: Math.max(
            memory.totalMemories - memory.learnedMemories,
            0,
          ),
          learningPercentage: memory.learningPercentage,
          level,
          levelLabel: this.getMemoryLevelLabel(level),
          levelColor: this.getMemoryLevelColor(level),
          lastUpdate: memory.lastUpdate,
          acquiredToday: today,
          acquiredThisWeek: week,
          acquiredThisMonth: month,
          growthRate,
        };
      }),
    );

    const totalAgents = syncedAgents.length;
    const activeAgents = syncedAgents.filter(
      (agent) => agent.status === "ACTIVE",
    ).length;
    const averageLearning =
      totalAgents === 0
        ? 0
        : Math.round(
            syncedAgents.reduce(
              (total, agent) => total + agent.learningPercentage,
              0,
            ) / totalAgents,
          );
    const totalMemoriesRegistered = syncedAgents.reduce(
      (total, agent) => total + agent.learnedMemories,
      0,
    );
    const [acquiredToday, acquiredThisWeek, acquiredThisMonth, previousWeek] =
      await Promise.all([
        this.sumMemoriesSince(tenantId, undefined, this.startOfDay(0)),
        this.sumMemoriesSince(tenantId, undefined, this.startOfDay(6)),
        this.sumMemoriesSince(tenantId, undefined, this.startOfDay(29)),
        this.sumMemoriesBetween(
          tenantId,
          undefined,
          this.startOfDay(13),
          this.startOfDay(7),
        ),
      ]);
    const growthRate =
      previousWeek === 0
        ? acquiredThisWeek > 0
          ? 100
          : 0
        : Math.round(((acquiredThisWeek - previousWeek) / previousWeek) * 100);
    const chart = await this.buildAgentMemoryChart(tenantId);

    return {
      summary: {
        totalAgents,
        activeAgents,
        averageLearning,
        totalMemoriesRegistered,
        acquiredToday,
        acquiredThisWeek,
        acquiredThisMonth,
        growthRate,
      },
      agents: syncedAgents,
      chart,
      stages: [
        {
          level: "BEGINNER",
          label: "Beginner",
          range: "0-10%",
          color: "#94a3b8",
        },
        {
          level: "LEARNING",
          label: "Learning",
          range: "10-30%",
          color: "#38bdf8",
        },
        {
          level: "DEVELOPING",
          label: "Developing",
          range: "30-50%",
          color: "#a78bfa",
        },
        {
          level: "EXPERIENCED",
          label: "Experienced",
          range: "50-70%",
          color: "#fbbf24",
        },
        {
          level: "MASTER",
          label: "Master",
          range: "70%+",
          color: "#34d399",
        },
      ],
    };
  }

  private async calculateAgentMemorySources(
    tenantId: string,
    agentId: string,
    knowledgeBaseIds: string[],
  ) {
    const hasKnowledgeBases = knowledgeBaseIds.length > 0;
    const [
      processedDocuments,
      faqs,
      chunks,
      usefulConversations,
      agentMessages,
      activeIntegrations,
    ] = await Promise.all([
      hasKnowledgeBases
        ? this.prisma.knowledgeDocument.count({
            where: {
              tenantId,
              knowledgeBaseId: { in: knowledgeBaseIds },
              status: "READY",
            },
          })
        : 0,
      hasKnowledgeBases
        ? this.prisma.faqItem.count({
            where: {
              tenantId,
              knowledgeBaseId: { in: knowledgeBaseIds },
              status: "PUBLISHED",
            },
          })
        : 0,
      hasKnowledgeBases
        ? this.prisma.knowledgeChunk.count({
            where: {
              tenantId,
              knowledgeBaseId: { in: knowledgeBaseIds },
            },
          })
        : 0,
      this.prisma.conversation.count({
        where: {
          tenantId,
          activeAiAgentId: agentId,
          status: "SOLVED",
        },
      }),
      this.prisma.message.count({
        where: {
          tenantId,
          senderAiAgentId: agentId,
        },
      }),
      this.prisma.integration.count({
        where: {
          tenantId,
          status: "ACTIVE",
        },
      }),
    ]);

    return {
      DOCUMENT_PROCESSED: processedDocuments * 5,
      FAQ_CREATED: faqs * 3,
      KNOWLEDGE_ADDED: Math.min(chunks, 40),
      CONVERSATION_USEFUL: usefulConversations * 4 + agentMessages,
      TRAINING_COMPLETED: 0,
      INTEGRATION_SYNC: activeIntegrations,
    };
  }

  private async upsertAgentMemory(input: {
    tenantId: string;
    agentId: string;
    existing: {
      learnedMemories: number;
      totalMemories: number;
      learningPercentage: number;
      level: string;
      lastUpdate: Date;
    } | null;
    learnedMemories: number;
    totalMemories: number;
    learningPercentage: number;
    level: "BEGINNER" | "LEARNING" | "DEVELOPING" | "EXPERIENCED" | "MASTER";
  }) {
    const changed =
      !input.existing ||
      input.existing.learnedMemories !== input.learnedMemories ||
      input.existing.totalMemories !== input.totalMemories ||
      input.existing.learningPercentage !== input.learningPercentage ||
      input.existing.level !== input.level;

    if (input.existing && !changed) {
      return input.existing;
    }

    return this.prisma.agentMemory.upsert({
      where: { agentId: input.agentId },
      create: {
        tenantId: input.tenantId,
        agentId: input.agentId,
        learnedMemories: input.learnedMemories,
        totalMemories: input.totalMemories,
        learningPercentage: input.learningPercentage,
        level: input.level,
        lastUpdate: new Date(),
      },
      update: {
        learnedMemories: input.learnedMemories,
        totalMemories: input.totalMemories,
        learningPercentage: input.learningPercentage,
        level: input.level,
        lastUpdate: new Date(),
      },
    });
  }

  private async recordMemoryHistoryDeltas(input: {
    tenantId: string;
    agentId: string;
    sourceTotals: Record<MemorySourceKey, number>;
  }) {
    const existingSums = await this.prisma.memoryHistory.groupBy({
      by: ["source"],
      where: {
        tenantId: input.tenantId,
        agentId: input.agentId,
      },
      _sum: {
        memoriesAdded: true,
      },
    });
    const existingBySource = new Map(
      existingSums.map((item) => [item.source, item._sum.memoriesAdded ?? 0]),
    );
    const rows = (Object.entries(input.sourceTotals) as Array<[MemorySourceKey, number]>)
      .map(([source, total]) => ({
        source,
        memoriesAdded: total - (existingBySource.get(source) ?? 0),
      }))
      .filter((item) => item.memoriesAdded > 0);

    if (!rows.length) return;

    await this.prisma.memoryHistory.createMany({
      data: rows.map((row) => ({
        tenantId: input.tenantId,
        agentId: input.agentId,
        source: row.source,
        memoriesAdded: row.memoriesAdded,
      })),
    });
  }

  private async sumMemoriesSince(
    tenantId: string,
    agentId: string | undefined,
    since: Date,
  ) {
    const result = await this.prisma.memoryHistory.aggregate({
      where: {
        tenantId,
        ...(agentId ? { agentId } : {}),
        createdAt: { gte: since },
      },
      _sum: {
        memoriesAdded: true,
      },
    });

    return result._sum.memoriesAdded ?? 0;
  }

  private async sumMemoriesBetween(
    tenantId: string,
    agentId: string | undefined,
    start: Date,
    end: Date,
  ) {
    const result = await this.prisma.memoryHistory.aggregate({
      where: {
        tenantId,
        ...(agentId ? { agentId } : {}),
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      _sum: {
        memoriesAdded: true,
      },
    });

    return result._sum.memoriesAdded ?? 0;
  }

  private async buildAgentMemoryChart(tenantId: string) {
    const start = this.startOfDay(13);
    const history = await this.prisma.memoryHistory.findMany({
      where: {
        tenantId,
        createdAt: { gte: start },
      },
      select: {
        memoriesAdded: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return Array.from({ length: 14 }).map((_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      const key = day.toISOString().slice(0, 10);
      const dailyGrowth = history
        .filter((item) => item.createdAt.toISOString().slice(0, 10) === key)
        .reduce((total, item) => total + item.memoriesAdded, 0);
      const weekStart = new Date(day);
      weekStart.setDate(day.getDate() - 6);
      const weeklyGrowth = history
        .filter((item) => item.createdAt >= weekStart && item.createdAt <= day)
        .reduce((total, item) => total + item.memoriesAdded, 0);

      return {
        date: key,
        dailyGrowth,
        weeklyGrowth,
      };
    });
  }

  private startOfDay(daysAgo: number) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private getMemoryLevel(percentage: number) {
    if (percentage >= 70) return "MASTER";
    if (percentage >= 50) return "EXPERIENCED";
    if (percentage >= 30) return "DEVELOPING";
    if (percentage >= 10) return "LEARNING";
    return "BEGINNER";
  }

  private getMemoryLevelLabel(level: string) {
    const labels: Record<string, string> = {
      BEGINNER: "Beginner",
      LEARNING: "Learning",
      DEVELOPING: "Developing",
      EXPERIENCED: "Experienced",
      MASTER: "Master",
    };
    return labels[level] ?? "Beginner";
  }

  private getMemoryLevelColor(level: string) {
    const colors: Record<string, string> = {
      BEGINNER: "#94a3b8",
      LEARNING: "#38bdf8",
      DEVELOPING: "#a78bfa",
      EXPERIENCED: "#fbbf24",
      MASTER: "#34d399",
    };
    return colors[level] ?? "#94a3b8";
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
