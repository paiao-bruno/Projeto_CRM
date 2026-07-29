import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { safeJsonStringify } from "../../../security/utils/redact-sensitive.util";
import { readEnvAutoSyncDefaults } from "./sgp-auto-sync.config";
import { SgpAutoSyncService } from "./sgp-auto-sync.service";

@Injectable()
export class SgpAutoSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SgpAutoSyncScheduler.name);
  private intervalHandle?: NodeJS.Timeout;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly autoSyncService: SgpAutoSyncService,
  ) {}

  onModuleInit() {
    const defaults = readEnvAutoSyncDefaults(process.env);
    if (!defaults.enabled) {
      this.logger.log("Sincronização automática SGP desabilitada via ambiente.");
      return;
    }

    if (defaults.cron) {
      const job = new CronJob(defaults.cron, () => {
        void this.autoSyncService.runDueSyncs("cron");
      });
      this.schedulerRegistry.addCronJob("sgp-auto-sync-cron", job);
      job.start();
      this.logger.log(
        safeJsonStringify({
          event: "sgp.auto-sync.scheduler.registered",
          mode: "cron",
          expression: defaults.cron,
        }),
      );
    }

    const intervalMs = defaults.intervalMinutes * 60_000;
    this.intervalHandle = setInterval(() => {
      void this.autoSyncService.runDueSyncs("interval");
    }, intervalMs);
    this.schedulerRegistry.addInterval("sgp-auto-sync-interval", this.intervalHandle);

    this.logger.log(
      safeJsonStringify({
        event: "sgp.auto-sync.scheduler.registered",
        mode: "interval",
        intervalMinutes: defaults.intervalMinutes,
      }),
    );
  }

  onModuleDestroy() {
    try {
      const cronJob = this.schedulerRegistry.getCronJob("sgp-auto-sync-cron");
      cronJob.stop();
      this.schedulerRegistry.deleteCronJob("sgp-auto-sync-cron");
    } catch {
      // cron job may not exist
    }

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.schedulerRegistry.deleteInterval("sgp-auto-sync-interval");
    }
  }
}
