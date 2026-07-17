import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthUser } from "../auth/types/auth-user";
import { CreateSgpCredentialsDto } from "./dto/create-sgp-credentials.dto";
import { UpdateSgpAutoSyncDto } from "./dto/update-sgp-auto-sync.dto";
import { TestSgpCredentialsDto, UpdateSgpCredentialsDto } from "./dto/update-sgp-credentials.dto";
import { IntegrationsService } from "./integrations.service";
import { SgpDiscoveryRequest } from "./sgp/types/sgp-client.types";

@UseGuards(JwtAuthGuard)
@Controller("integrations")
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get("sgp/credentials")
  listSgpCredentials(@CurrentUser() user: AuthUser) {
    return this.integrationsService.listSgpCredentials(user.tenantId);
  }

  @Get("sgp/credentials/:id")
  getSgpCredentials(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.integrationsService.getSgpCredentials(user.tenantId, id);
  }

  @Post("sgp/credentials")
  createSgpCredentials(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateSgpCredentialsDto,
  ) {
    return this.integrationsService.createSgpCredentials(user.tenantId, body);
  }

  @Patch("sgp/credentials/:id")
  updateSgpCredentials(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: UpdateSgpCredentialsDto,
  ) {
    return this.integrationsService.updateSgpCredentials(user.tenantId, id, body);
  }

  @Delete("sgp/credentials/:id")
  removeSgpCredentials(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.integrationsService.removeSgpCredentials(user.tenantId, id);
  }

  @Post("sgp/credentials/:id/test")
  testStoredSgpCredentials(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: TestSgpCredentialsDto = {},
  ) {
    return this.integrationsService.testSgpCredentials(user, body, id);
  }

  @Post("sgp/credentials/test")
  testSgpCredentials(
    @CurrentUser() user: AuthUser,
    @Body() body: TestSgpCredentialsDto,
  ) {
    return this.integrationsService.testSgpCredentials(user, body);
  }

  @Get("sgp/auto-sync")
  getSgpAutoSync(
    @CurrentUser() user: AuthUser,
    @Query("credentialId") credentialId?: string,
  ) {
    return this.integrationsService.getSgpAutoSyncConfig(user.tenantId, credentialId);
  }

  @Patch("sgp/auto-sync")
  updateSgpAutoSync(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateSgpAutoSyncDto,
  ) {
    return this.integrationsService.updateSgpAutoSyncConfig(user.tenantId, body);
  }

  @Post("sgp/auto-sync/run")
  runSgpAutoSync(@CurrentUser() user: AuthUser) {
    return this.integrationsService.triggerManualAutoSync(user.tenantId);
  }

  @Post("sgp/test-auth")
  testSgpAuth(
    @CurrentUser() user: AuthUser,
    @Body() body?: SgpDiscoveryRequest,
  ) {
    return this.integrationsService.testSgpAuth(user, body, body?.credentialId);
  }

  @Post("sgp/discover/customers")
  discoverSgpCustomers(
    @CurrentUser() user: AuthUser,
    @Body() body?: SgpDiscoveryRequest,
  ) {
    return this.integrationsService.discoverSgpCustomers(user, body);
  }

  @Post("sgp/debug")
  debugSgp(@CurrentUser() user: AuthUser, @Body() body: SgpDiscoveryRequest) {
    return this.integrationsService.debugSgp(user, body);
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
