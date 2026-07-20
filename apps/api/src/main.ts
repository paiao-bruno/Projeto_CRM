import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { assertProductionEnvironment } from "./config/production-env";
import { HttpExceptionFilter } from "./security/filters/http-exception.filter";
import { createGlobalValidationPipe } from "./security/pipes/global-validation.pipe";
import { readSecurityConfig } from "./security/security.config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  assertProductionEnvironment(config);
  const security = readSecurityConfig({
    ...process.env,
    NODE_ENV: config.get<string>("NODE_ENV") ?? process.env.NODE_ENV,
    APP_URL: config.get<string>("APP_URL") ?? process.env.APP_URL,
  });

  if (config.get<string>("NODE_ENV") === "production") {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set("trust proxy", 1);
  }

  app.use(json({ limit: security.bodySizeLimit }));
  app.use(urlencoded({ extended: true, limit: security.bodySizeLimit }));

  app.use(
    helmet({
      contentSecurityPolicy: security.hideValidationDetails ? undefined : false,
      crossOriginEmbedderPolicy: false,
      xssFilter: true,
      noSniff: true,
      referrerPolicy: { policy: "no-referrer" },
      hsts: security.hideValidationDetails
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    }),
  );

  app.enableCors({
    origin: security.corsOrigins,
    credentials: security.corsCredentials,
    methods: security.corsMethods,
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86_400,
  });

  app.setGlobalPrefix("api");
  app.useGlobalPipes(createGlobalValidationPipe(config));

  const port = config.get<number>("PORT", 4000);
  await app.listen(port);
  Logger.log(`API running on http://localhost:${port}/api`, "Bootstrap");
}

void bootstrap();
