import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardSgpSyncService } from "./dashboard-sgp-sync.service";
import { DashboardService } from "./dashboard.service";

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardSgpSyncService],
})
export class DashboardModule {}
