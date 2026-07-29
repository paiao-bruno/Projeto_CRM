import { IntegrationSyncStatus } from "@prisma/client";

export type DashboardHealthStatus = "healthy" | "warning" | "critical" | "unknown";

export type DashboardSgpSyncHealthIndicator = {
  label: string;
  status: DashboardHealthStatus;
  detail?: string;
};

export type DashboardSgpSyncHistoryItem = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: IntegrationSyncStatus;
  recordCount: number;
  errorsCount: number;
  syncMode: string | null;
  trigger: string | null;
};

export type DashboardSgpSyncOverview = {
  lastSync: {
    id: string;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    status: IntegrationSyncStatus;
    recordCount: number;
    errorsCount: number;
    syncMode: string | null;
    trigger: string | null;
    triggeredBy: string | null;
  } | null;
  runningSync: {
    id: string;
    startedAt: string;
    status: IntegrationSyncStatus;
    recordCount: number;
    triggeredBy: string | null;
  } | null;
  averageDurationMs: number | null;
  recordCount: number;
  errorsCount: number;
  health: DashboardSgpSyncHealthIndicator[];
  recentHistory: DashboardSgpSyncHistoryItem[];
};
