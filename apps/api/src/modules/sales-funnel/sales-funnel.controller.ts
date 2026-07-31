import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/types/auth-user";
import { RequirePermissions } from "../../security/decorators/require-permissions.decorator";
import { SalesFunnelService } from "./sales-funnel.service";
import { SalesFunnelMetricsService } from "./sales-funnel-metrics.service";
import { CreateDealDto } from "./dto/create-deal.dto";
import { UpdateDealDto } from "./dto/update-deal.dto";
import { MoveDealDto } from "./dto/move-deal.dto";
import { MarkDealLostDto } from "./dto/mark-deal-lost.dto";
import { ListDealsQueryDto } from "./dto/list-deals-query.dto";

@RequirePermissions("sales_funnel.read")
@Controller("sales-funnel")
export class SalesFunnelController {
  constructor(
    private readonly salesFunnelService: SalesFunnelService,
    private readonly metricsService: SalesFunnelMetricsService,
  ) {}

  @Get("board")
  getBoard(@CurrentUser() user: AuthUser, @Query() query: ListDealsQueryDto) {
    return this.salesFunnelService.getBoard(user, {
      ...query,
      createdFrom: query.createdFrom ? new Date(query.createdFrom) : undefined,
      createdTo: query.createdTo ? new Date(query.createdTo) : undefined,
    });
  }

  @Get("deals")
  listDeals(@CurrentUser() user: AuthUser, @Query() query: ListDealsQueryDto) {
    return this.salesFunnelService.listDeals(user, query);
  }

  @Get("deals/:id")
  getDeal(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.salesFunnelService.getDeal(user, id);
  }

  @RequirePermissions("sales_funnel.manage")
  @Post("deals")
  createDeal(@CurrentUser() user: AuthUser, @Body() dto: CreateDealDto) {
    return this.salesFunnelService.createDeal(user, dto);
  }

  @RequirePermissions("sales_funnel.manage")
  @Patch("deals/:id")
  updateDeal(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateDealDto,
  ) {
    return this.salesFunnelService.updateDeal(user, id, dto);
  }

  @RequirePermissions("sales_funnel.manage")
  @Post("deals/:id/move")
  moveDeal(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: MoveDealDto,
  ) {
    return this.salesFunnelService.moveDeal(user, id, dto);
  }

  @RequirePermissions("sales_funnel.manage")
  @Post("deals/:id/mark-lost")
  markLost(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: MarkDealLostDto,
  ) {
    return this.salesFunnelService.markLost(user, id, dto);
  }

  @RequirePermissions("sales_funnel.manage")
  @Post("deals/:id/archive")
  archiveDeal(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.salesFunnelService.archiveDeal(user, id);
  }

  @RequirePermissions("sales_funnel.manage")
  @Post("deals/:id/restore")
  restoreDeal(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.salesFunnelService.restoreDeal(user, id);
  }

  @Get("members")
  listMembers(@CurrentUser() user: AuthUser) {
    return this.salesFunnelService.listMembers(user.tenantId);
  }

  @Get("metrics")
  getMetrics(@CurrentUser() user: AuthUser, @Query() query: ListDealsQueryDto) {
    return this.metricsService.getMetrics(user.tenantId, query);
  }
}
