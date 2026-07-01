import { Module } from "@nestjs/common";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";
import { SgpClientService } from "./sgp/sgp-client.service";

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, SgpClientService],
})
export class IntegrationsModule {}
