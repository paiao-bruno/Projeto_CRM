import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AiAgentsModule } from "./modules/ai-agents/ai-agents.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ChatModule } from "./modules/chat/chat.module";
import { ContractsModule } from "./modules/contracts/contracts.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { DatabaseModule } from "./modules/database/database.module";
import { IntegrationsModule } from "./modules/integrations/integrations.module";
import { InvoicesModule } from "./modules/invoices/invoices.module";
import { SeedModule } from "./modules/seed/seed.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    DatabaseModule,
    SeedModule,
    AuthModule,
    DashboardModule,
    CustomersModule,
    ChatModule,
    AiAgentsModule,
    IntegrationsModule,
    ContractsModule,
    InvoicesModule,
  ],
})
export class AppModule {}
