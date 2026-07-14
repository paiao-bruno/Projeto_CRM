import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthUser } from "../auth/types/auth-user";
import { IntegrationsService } from "./integrations.service";
import { SgpDiscoveryRequest } from "./sgp/types/sgp-client.types";

@UseGuards(JwtAuthGuard)
@Controller("integrations")
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Post("sgp/test-auth")
  testSgpAuth(@Body() body?: SgpDiscoveryRequest) {
    return this.integrationsService.testSgpAuth(body);
  }

  @Post("sgp/discover/customers")
  discoverSgpCustomers(
    @CurrentUser() user: AuthUser,
    @Body() body?: SgpDiscoveryRequest,
  ) {
    return this.integrationsService.discoverSgpCustomers(user, body);
  }

  @Post("sgp/debug")
  debugSgp(@Body() body: SgpDiscoveryRequest) {
    return this.integrationsService.debugSgp(body);
  }

  @Post("sgp/sync-customers")
  syncSgpCustomers(
    @CurrentUser() user: AuthUser,
    @Body() body?: SgpDiscoveryRequest,
  ) {
    return this.integrationsService.syncSgpCustomers(user, body);
  }

  @Get("sgp/sync-status")
  getSgpSyncStatus(@CurrentUser() user: AuthUser) {
    return this.integrationsService.getSgpSyncStatus(user.tenantId);
  }

  @Get("sgp/sync-runs")
  listSgpSyncRuns(@CurrentUser() user: AuthUser) {
    return this.integrationsService.listSgpSyncRuns(user.tenantId);
  }

  @Get("sgp/sync-runs/:id")
  getSgpSyncRun(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.integrationsService.getSgpSyncRun(user.tenantId, id);
  }
}
