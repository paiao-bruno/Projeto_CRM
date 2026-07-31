import { Module } from "@nestjs/common";
import { SalesFunnelController } from "./sales-funnel.controller";
import { SalesFunnelService } from "./sales-funnel.service";
import { SalesFunnelMetricsService } from "./sales-funnel-metrics.service";

@Module({
  controllers: [SalesFunnelController],
  providers: [SalesFunnelService, SalesFunnelMetricsService],
  exports: [SalesFunnelService, SalesFunnelMetricsService],
})
export class SalesFunnelModule {}
