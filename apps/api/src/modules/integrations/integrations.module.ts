import { Module } from "@nestjs/common";
import { CustomersModule } from "../customers/customers.module";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";
import { SgpClientService } from "./sgp/sgp-client.service";

@Module({
  imports: [CustomersModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, SgpClientService],
})
export class IntegrationsModule {}
