import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { CustomersModule } from "../customers/customers.module";
import { EncryptionService } from "./crypto/encryption.service";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";
import { SgpAutoSyncScheduler } from "./sgp/sgp-auto-sync.scheduler";
import { SgpAutoSyncService } from "./sgp/sgp-auto-sync.service";
import { SgpClientService } from "./sgp/sgp-client.service";
import { SgpCredentialsService } from "./sgp/sgp-credentials.service";

@Module({
  imports: [ScheduleModule.forRoot(), CustomersModule],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    SgpClientService,
    SgpCredentialsService,
    EncryptionService,
    SgpAutoSyncService,
    SgpAutoSyncScheduler,
  ],
  exports: [IntegrationsService, SgpCredentialsService, SgpAutoSyncService],
})
export class IntegrationsModule {}
