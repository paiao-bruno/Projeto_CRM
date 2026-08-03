import { DashboardOverview } from "./types";

const KNOWLEDGE_STAGES = [
  { level: "BEGINNER", label: "Beginner", range: "0-25%", color: "#94a3b8" },
  { level: "LEARNING", label: "Learning", range: "26-50%", color: "#38bdf8" },
  { level: "DEVELOPING", label: "Developing", range: "51-75%", color: "#f59e0b" },
  { level: "EXPERIENCED", label: "Experienced", range: "76-90%", color: "#8b5cf6" },
  { level: "MASTER", label: "Master", range: "91-100%", color: "#22c55e" },
];

const CONNECTION_LABELS = [
  "PostgreSQL",
  "Redis",
  "API NestJS",
  "SGP Integration",
  "WhatsApp Gateway",
];

const SGP_HEALTH_LABELS = [
  "Credenciais configuradas",
  "Última sincronização",
  "Erros recentes",
  "Conectividade SGP",
];

/** Estrutura visual do dashboard sem métricas reais (modo web-only). */
export function createWebOnlyDashboardShell(): DashboardOverview {
  return {
    cards: {
      messagesProcessed: 0,
      activeConversations: 0,
      onlineAgents: 0,
      responseRate: 0,
      averageResponseTime: "—",
      conversions: 0,
      activeContracts: 0,
      overdueInvoices: 0,
    },
    chart: [],
    channelDistribution: [],
    agentPerformance: [],
    agentMemory: {
      summary: {
        totalAgents: 0,
        activeAgents: 0,
        averageLearning: 0,
        totalMemoriesRegistered: 0,
        acquiredToday: 0,
        acquiredThisWeek: 0,
        acquiredThisMonth: 0,
        growthRate: 0,
      },
      agents: [],
      chart: [],
      stages: KNOWLEDGE_STAGES,
    },
    health: CONNECTION_LABELS.map((label) => ({
      label,
      status: "indisponível",
    })),
    sgpSync: {
      lastSync: null,
      runningSync: null,
      averageDurationMs: null,
      recordCount: 0,
      errorsCount: 0,
      health: SGP_HEALTH_LABELS.map((label) => ({
        label,
        status: "unknown" as const,
        detail: "API temporariamente desligada",
      })),
      recentHistory: [],
    },
  };
}

/** Exibe métrica como indisponível no modo web-only (evita zero como valor real). */
export function formatWebOnlyMetric(value: string | number, webOnly: boolean): string {
  if (webOnly) return "—";
  if (typeof value === "number") return String(value);
  return value;
}
