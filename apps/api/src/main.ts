import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { assertProductionEnvironment } from "./config/production-env";
import { createGlobalValidationPipe } from "./security/pipes/global-validation.pipe";
import { readSecurityConfig } from "./security/security.config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  assertProductionEnvironment(config);
  const security = readSecurityConfig({
    ...process.env,
    NODE_ENV: config.get<string>("NODE_ENV") ?? process.env.NODE_ENV,
    APP_URL: config.get<string>("APP_URL") ?? process.env.APP_URL,
  });

  app.use(
    helmet({
      contentSecurityPolicy: security.hideValidationDetails ? undefined : false,
      crossOriginEmbedderPolicy: false,
      xssFilter: true,
      noSniff: true,
      referrerPolicy: { policy: "no-referrer" },
    }),
  );

  app.enableCors({
    origin: security.corsOrigins,
    credentials: security.corsCredentials,
    methods: security.corsMethods,
  });

  app.setGlobalPrefix("api");
  app.useGlobalPipes(createGlobalValidationPipe(config));

  const port = config.get<number>("PORT", 4000);
  await app.listen(port);
  Logger.log(`API running on http://localhost:${port}/api`, "Bootstrap");
}

void bootstrap();
