import { Injectable } from "@nestjs/common";
import { IntegrationProvider, IntegrationSyncStatus } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { readAutoSyncConfig, readEnvAutoSyncDefaults } from "../integrations/sgp/sgp-auto-sync.config";
import { mapSgpSyncHistoryEntry } from "../integrations/sgp/sgp-sync-history.mapper";
import {
  DashboardHealthStatus,
  DashboardSgpSyncHealthIndicator,
  DashboardSgpSyncHistoryItem,
  DashboardSgpSyncOverview,
} from "./dashboard-sgp-sync.types";

@Injectable()
export class DashboardSgpSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(tenantId: string): Promise<DashboardSgpSyncOverview> {
    const operation = "sgp.sync-customers";

    const [latestRun, runningRun, recentRuns, sgpIntegrations, durationAggregate] =
      await Promise.all([
        this.prisma.integrationSyncRun.findFirst({
          where: {
            tenantId,
            operation,
            status: { not: IntegrationSyncStatus.RUNNING },
          },
          include: this.historyInclude(),
          orderBy: { startedAt: "desc" },
        }),
        this.prisma.integrationSyncRun.findFirst({
          where: {
            tenantId,
            operation,
            status: IntegrationSyncStatus.RUNNING,
          },
          include: this.historyInclude(),
          orderBy: { startedAt: "desc" },
        }),
        this.prisma.integrationSyncRun.findMany({
          where: { tenantId, operation },
          include: this.historyInclude(),
          orderBy: { startedAt: "desc" },
          take: 8,
        }),
        this.prisma.integration.findMany({
          where: {
            tenantId,
            provider: IntegrationProvider.SGP,
          },
          orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        }),
        this.prisma.integrationSyncRun.aggregate({
          where: {
            tenantId,
            operation,
            status: {
              in: [
                IntegrationSyncStatus.COMPLETED,
                IntegrationSyncStatus.PARTIAL,
                IntegrationSyncStatus.FAILED,
              ],
            },
            durationMs: { not: null },
            finishedAt: { not: null },
          },
          _avg: { durationMs: true },
          _count: { _all: true },
        }),
      ]);

    const latest = latestRun ? mapSgpSyncHistoryEntry(latestRun) : null;
    const running = runningRun ? mapSgpSyncHistoryEntry(runningRun) : null;
    const activeIntegration =
      sgpIntegrations.find((item) => item.status === "ACTIVE") ?? sgpIntegrations[0] ?? null;
    const autoSyncConfig = activeIntegration
      ? readAutoSyncConfig(activeIntegration.config, readEnvAutoSyncDefaults(process.env))
      : readAutoSyncConfig(null, readEnvAutoSyncDefaults(process.env));

    const recordCount = this.countRecords(latest);
    const errorsCount = latest?.errorsCount ?? 0;

    return {
      lastSync: latest
        ? {
            id: latest.id,
            startedAt: latest.startedAt,
            finishedAt: latest.finishedAt,
            durationMs: latest.durationMs,
            status: latest.status,
            recordCount: this.countRecords(latest),
            errorsCount: latest.errorsCount,
            syncMode: latest.syncMode,
            trigger: latest.trigger,
            triggeredBy: latest.triggeredBy?.name ?? null,
          }
        : null,
      runningSync: running
        ? {
            id: running.id,
            startedAt: running.startedAt,
            status: running.status,
            recordCount: this.countRecords(running),
            triggeredBy: running.triggeredBy?.name ?? null,
          }
        : null,
      averageDurationMs:
        durationAggregate._count._all > 0
          ? Math.round(durationAggregate._avg.durationMs ?? 0)
          : null,
      recordCount,
      errorsCount,
      health: this.buildHealthIndicators({
        integrations: sgpIntegrations,
        autoSyncEnabled: autoSyncConfig.enabled,
        latestStatus: latest?.status ?? null,
        runningSync: Boolean(running),
        latestErrors: errorsCount,
      }),
      recentHistory: recentRuns.map((run) => this.toHistoryItem(run)),
    };
  }

  private historyInclude() {
    return {
      tenant: {
        select: {
          id: true,
          name: true,
        },
      },
      triggeredBy: {
        select: {
          id: true,
          displayName: true,
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    };
  }

  private countRecords(
    entry: ReturnType<typeof mapSgpSyncHistoryEntry> | null | undefined,
  ) {
    if (!entry) return 0;
    return (
      entry.customers.processed +
      entry.contracts.processed +
      entry.invoices.processed
    );
  }

  private toHistoryItem(
    run: Parameters<typeof mapSgpSyncHistoryEntry>[0],
  ): DashboardSgpSyncHistoryItem {
    const entry = mapSgpSyncHistoryEntry(run);
    return {
      id: entry.id,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
      durationMs: entry.durationMs,
      status: entry.status,
      recordCount: this.countRecords(entry),
      errorsCount: entry.errorsCount,
      syncMode: entry.syncMode,
      trigger: entry.trigger,
    };
  }

  private buildHealthIndicators(input: {
    integrations: Array<{
      status: string;
      healthStatus: string;
      lastError: string | null;
      name: string;
    }>;
    autoSyncEnabled: boolean;
    latestStatus: IntegrationSyncStatus | null;
    runningSync: boolean;
    latestErrors: number;
  }): DashboardSgpSyncHealthIndicator[] {
    const activeIntegrations = input.integrations.filter((item) => item.status === "ACTIVE");
    const degradedIntegrations = input.integrations.filter(
      (item) => item.healthStatus === "WARNING" || item.healthStatus === "DOWN",
    );

    const indicators: DashboardSgpSyncHealthIndicator[] = [
      {
        label: "Credenciais SGP",
        status: this.mapIntegrationHealth(
          input.integrations.length === 0
            ? "missing"
            : activeIntegrations.length > 0
              ? "ok"
              : "warning",
        ),
        detail:
          input.integrations.length === 0
            ? "Nenhuma credencial configurada"
            : `${activeIntegrations.length} ativa(s) de ${input.integrations.length}`,
      },
      {
        label: "Conexão SGP",
        status: this.mapIntegrationHealth(
          degradedIntegrations.length > 0
            ? "warning"
            : activeIntegrations.length > 0
              ? "ok"
              : input.integrations.length > 0
                ? "warning"
                : "missing",
        ),
        detail:
          degradedIntegrations[0]?.lastError ??
          activeIntegrations[0]?.name ??
          "Integração não configurada",
      },
      {
        label: "Sincronização automática",
        status: input.autoSyncEnabled ? "healthy" : "warning",
        detail: input.autoSyncEnabled ? "Habilitada" : "Desabilitada",
      },
      {
        label: "Última execução",
        status: this.mapSyncStatusHealth(input.latestStatus, input.latestErrors),
        detail: input.latestStatus ?? "Sem execuções registradas",
      },
      {
        label: "Execução em andamento",
        status: input.runningSync ? "warning" : "healthy",
        detail: input.runningSync ? "Sync SGP em progresso" : "Nenhuma sync ativa",
      },
    ];

    return indicators;
  }

  private mapIntegrationHealth(
    state: "ok" | "warning" | "missing",
  ): DashboardHealthStatus {
    if (state === "ok") return "healthy";
    if (state === "warning") return "warning";
    return "critical";
  }

  private mapSyncStatusHealth(
    status: IntegrationSyncStatus | null,
    errorsCount: number,
  ): DashboardHealthStatus {
    if (!status) return "unknown";
    if (status === IntegrationSyncStatus.RUNNING) return "warning";
    if (status === IntegrationSyncStatus.FAILED) return "critical";
    if (status === IntegrationSyncStatus.PARTIAL || errorsCount > 0) return "warning";
    if (status === IntegrationSyncStatus.COMPLETED) return "healthy";
    if (status === IntegrationSyncStatus.SKIPPED) return "unknown";
    return "unknown";
  }
}
