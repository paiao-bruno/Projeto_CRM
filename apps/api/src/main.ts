import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const webUrl = config.get<string>("APP_URL", "http://localhost:3000");

  app.enableCors({
    origin: [webUrl, "http://localhost:3000"],
    credentials: true,
  });

  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = config.get<number>("PORT", 4000);
  await app.listen(port);
  console.log(`API running on http://localhost:${port}/api`);
}

void bootstrap();
