import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";

@Injectable()
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly config: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const isProduction = this.config.get<string>("NODE_ENV") === "production";

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const body =
        typeof payload === "string"
          ? { statusCode: status, message: payload }
          : this.sanitizePayload(payload as Record<string, unknown>, isProduction);

      if (status >= 500) {
        this.logger.error(
          `${request.method} ${request.url} -> ${status}`,
          isProduction ? undefined : exception.stack,
        );
      }

      response.status(status).json(body);
      return;
    }

    this.logger.error(
      `${request.method} ${request.url} -> 500`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: isProduction
        ? "Erro interno do servidor."
        : exception instanceof Error
          ? exception.message
          : "Erro interno do servidor.",
    });
  }

  private sanitizePayload(payload: Record<string, unknown>, isProduction: boolean) {
    if (!isProduction) {
      return payload;
    }

    const { stack, stackTrace, trace, ...safe } = payload;
    return safe;
  }
}
