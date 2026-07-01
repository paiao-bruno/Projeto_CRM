import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
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
  discoverSgpCustomers(@Body() body?: SgpDiscoveryRequest) {
    return this.integrationsService.discoverSgpCustomers(body);
  }
}
