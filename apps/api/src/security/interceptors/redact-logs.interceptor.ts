import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { safeJsonStringify } from "../utils/redact-sensitive.util";

@Injectable()
export class RedactLogsInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HttpRequest");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      body?: unknown;
      query?: unknown;
    }>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(
            safeJsonStringify({
              event: "http.request.completed",
              method: request.method,
              url: request.url,
              durationMs: Date.now() - startedAt,
              query: request.query,
              body: request.body,
            }),
          );
        },
        error: (error: unknown) => {
          this.logger.warn(
            safeJsonStringify({
              event: "http.request.failed",
              method: request.method,
              url: request.url,
              durationMs: Date.now() - startedAt,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        },
      }),
    );
  }
}
