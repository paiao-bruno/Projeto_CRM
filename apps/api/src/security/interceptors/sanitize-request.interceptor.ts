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

function replaceObjectContents(target: Record<string, unknown>, source: unknown) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return;
  }

  for (const key of Object.keys(target)) {
    delete target[key];
  }

  Object.assign(target, source as Record<string, unknown>);
}

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
      query?: Record<string, unknown>;
      params?: Record<string, unknown>;
    }>();

    if (request.body !== undefined) {
      request.body = sanitizeUnknownValue(request.body);
    }

    if (request.query && typeof request.query === "object") {
      replaceObjectContents(request.query, sanitizeUnknownValue(request.query));
    }

    if (request.params && typeof request.params === "object") {
      replaceObjectContents(request.params, sanitizeUnknownValue(request.params));
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
