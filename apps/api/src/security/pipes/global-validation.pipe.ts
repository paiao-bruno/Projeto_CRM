import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readSecurityConfig } from "../security.config";

export function createGlobalValidationPipe(config: ConfigService) {
  const security = readSecurityConfig({
    ...process.env,
    NODE_ENV: config.get<string>("NODE_ENV") ?? process.env.NODE_ENV,
  });

  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
    forbidUnknownValues: true,
    disableErrorMessages: security.hideValidationDetails,
    validationError: {
      target: false,
      value: false,
    },
  });
}
