import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IntegrationsService } from "../integrations.service";
import { safeJsonStringify } from "../../../security/utils/redact-sensitive.util";
import { isAutoSyncDue, readAutoSyncConfig, readEnvAutoSyncDefaults } from "./sgp-auto-sync.config";
import { SgpCredentialsService } from "./sgp-credentials.service";

@Injectable()
export class SgpAutoSyncService {
  private readonly logger = new Logger(SgpAutoSyncService.name);
  private readonly runningTenants = new Set<string>();

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly sgpCredentials: SgpCredentialsService,
    private readonly config: ConfigService,
  ) {}

  async runDueSyncs(trigger: "cron" | "interval" | "manual" = "cron") {
    const timeoutMs = Number(this.config.get("SGP_AUTO_SYNC_TIMEOUT_MS") ?? 900_000);
    await this.integrationsService.recoverStaleSyncRuns(timeoutMs);

    const integrations = await this.sgpCredentials.listAutoSyncCandidates();
    const results: Array<{ tenantId: string; status: string; runId?: string; error?: string }> = [];

    for (const integration of integrations) {
      const config = readAutoSyncConfig(
        integration.config,
        readEnvAutoSyncDefaults(process.env),
      );

      if (!config.enabled) {
        continue;
      }

      const lastRunAt = config.lastRunAt ? new Date(config.lastRunAt) : null;
      if (trigger !== "manual" && !isAutoSyncDue(config, lastRunAt)) {
        continue;
      }

      if (this.runningTenants.has(integration.tenantId)) {
        this.logger.warn(
          safeJsonStringify({
            event: "sgp.auto-sync.skipped",
            tenantId: integration.tenantId,
            integrationId: integration.id,
            reason: "scheduler_lock",
          }),
        );
        results.push({ tenantId: integration.tenantId, status: "already_running" });
        continue;
      }

      this.runningTenants.add(integration.tenantId);
      try {
        const result = await this.integrationsService.runAutomatedSgpSync({
          tenantId: integration.tenantId,
          integrationId: integration.id,
          trigger,
          retryAttempts: config.retryAttempts,
          retryDelayMs: config.retryDelayMs,
          timeoutMs: config.timeoutMs,
        });
        results.push({
          tenantId: integration.tenantId,
          status: result.status,
          runId: result.runId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          tenantId: integration.tenantId,
          status: "failed",
          error: message,
        });
      } finally {
        this.runningTenants.delete(integration.tenantId);
      }
    }

    this.logger.log(
      safeJsonStringify({
        event: "sgp.auto-sync.batch.finished",
        trigger,
        processed: results.length,
        results,
      }),
    );

    return results;
  }
}
