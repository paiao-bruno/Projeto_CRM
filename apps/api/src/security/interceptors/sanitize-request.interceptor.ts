import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Observable } from "rxjs";
import { readSecurityConfig } from "../security.config";
import { sanitizeUnknownValue } from "../utils/sanitize.util";
import { assertNoSqlInjection } from "../utils/sql-injection.util";

@Injectable()
export class SanitizeRequestInterceptor implements NestInterceptor {
  private readonly config = readSecurityConfig(process.env);

  constructor(configService: ConfigService) {
    this.config = readSecurityConfig({
      ...process.env,
      NODE_ENV: configService.get<string>("NODE_ENV") ?? process.env.NODE_ENV,
    });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.config.sanitizeRequests) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<{
      body?: unknown;
      query?: unknown;
      params?: unknown;
    }>();

    if (request.body !== undefined) {
      request.body = sanitizeUnknownValue(request.body);
    }

    if (request.query !== undefined) {
      request.query = sanitizeUnknownValue(request.query) as typeof request.query;
    }

    if (request.params !== undefined) {
      request.params = sanitizeUnknownValue(request.params) as typeof request.params;
    }

    if (this.config.sqlInjectionGuard) {
      try {
        assertNoSqlInjection(request.body, "body");
        assertNoSqlInjection(request.query, "query");
        assertNoSqlInjection(request.params, "params");
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : "Entrada inválida.",
        );
      }
    }

    return next.handle();
  }
}
