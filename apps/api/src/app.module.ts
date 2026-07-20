import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
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
import { readSecurityConfig } from "./security/security.config";
import { SecurityModule } from "./security/security.module";

const seedEnabled =
  process.env.NODE_ENV !== "production" && process.env.AUTO_SEED_DEMO !== "false";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const security = readSecurityConfig({
          ...process.env,
          NODE_ENV: config.get<string>("NODE_ENV"),
          APP_URL: config.get<string>("APP_URL"),
        });

        return [
          {
            ttl: security.rateLimitTtlMs,
            limit: security.rateLimitMax,
          },
        ];
      },
    }),
    SecurityModule,
    DatabaseModule,
    ...(seedEnabled ? [SeedModule] : []),
    AuthModule,
    DashboardModule,
    CustomersModule,
    ChatModule,
    AiAgentsModule,
    IntegrationsModule,
    ContractsModule,
    InvoicesModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
