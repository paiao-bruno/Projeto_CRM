import { Module } from "@nestjs/common";
import { CustomersModule } from "../customers/customers.module";
import { EncryptionService } from "./crypto/encryption.service";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";
import { SgpClientService } from "./sgp/sgp-client.service";
import { SgpCredentialsService } from "./sgp/sgp-credentials.service";

@Module({
  imports: [CustomersModule],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    SgpClientService,
    SgpCredentialsService,
    EncryptionService,
  ],
  exports: [IntegrationsService, SgpCredentialsService],
})
export class IntegrationsModule {}
