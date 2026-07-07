import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  SgpErrorCode,
  SgpHttpResponse,
  SgpRequestOptions,
} from "./types/sgp-client.types";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CUSTOMER_DISCOVERY_ENDPOINT = "/api/ura/consultacliente/";
const OFFICIAL_CUSTOMERS_LIST_ENDPOINTS = [
  "/api/v2/integra/clientes/",
  "/api/v1/fechamento/clientes/",
];
const SENSITIVE_KEYS = new Set([
  "token",
  "senha",
  "password",
  "authorization",
  "app",
  "secret",
]);

@Injectable()
export class SgpClientService {
  private readonly logger = new Logger(SgpClientService.name);

  constructor(private readonly config: ConfigService) {}

  testAuth(payload?: Record<string, unknown>, endpoint?: string) {
    return this.request({
      operation: "sgp.test-auth",
      endpoint: endpoint ?? DEFAULT_CUSTOMER_DISCOVERY_ENDPOINT,
      payload,
    });
  }

  discoverCustomers(payload?: Record<string, unknown>, endpoint?: string) {
    if (endpoint) {
      return this.request({
        operation: "sgp.discover-customers",
        endpoint,
        payload,
      });
    }

    const configuredEndpoint = this.config.get<string>("SGP_CUSTOMERS_ENDPOINT");
    const endpoints = [
      ...(configuredEndpoint ? [configuredEndpoint] : []),
      ...OFFICIAL_CUSTOMERS_LIST_ENDPOINTS,
    ].filter((candidate, index, list) => list.indexOf(candidate) === index);

    return this.requestWithFallback({
      operation: "sgp.discover-customers",
      endpoints,
      payload,
    });
  }

  debug(endpoint: string, payload?: Record<string, unknown>) {
    return this.request({
      operation: "sgp.debug",
      endpoint,
      payload,
    });
  }

  async request(options: SgpRequestOptions): Promise<SgpHttpResponse> {
    const startedAt = new Date();
    const startedAtMs = Date.now();
    const controller = new AbortController();
    const timeoutMs = this.getTimeoutMs();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = this.buildUrl(options.endpoint);
      const payload = this.buildAuthenticatedPayload(options.payload);

      this.logger.log(
        JSON.stringify({
          event: "sgp.request.started",
          operation: options.operation,
          endpoint: options.endpoint,
          url: this.redactUrl(url.toString()),
          startedAt: startedAt.toISOString(),
          timeoutMs,
          payload: this.sanitize(payload),
        }),
      );

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const durationMs = Date.now() - startedAtMs;
      const body = await this.parseBody(response);
      this.assertNotHtmlResponse({
        body,
        endpoint: options.endpoint,
        exactUrl: url.toString(),
        status: response.status,
        statusText: response.statusText,
      });
      const headers = Object.fromEntries(response.headers.entries());
      const result: SgpHttpResponse = {
        status: response.status,
        statusText: response.statusText,
        headers,
        body,
        durationMs,
      };

      this.logger.log(
        JSON.stringify({
          event: "sgp.request.finished",
          operation: options.operation,
          endpoint: options.endpoint,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          response: this.sanitize(body),
        }),
      );

      if (!response.ok) {
        throw this.toHttpException(
          response.status === HttpStatus.UNAUTHORIZED ||
            response.status === HttpStatus.FORBIDDEN
            ? "SGP_AUTH_FAILED"
            : "SGP_UNEXPECTED_RESPONSE",
          response.status === HttpStatus.UNAUTHORIZED ||
            response.status === HttpStatus.FORBIDDEN
            ? "Falha de autenticação ao consultar o SGP."
            : "O SGP retornou uma resposta inesperada.",
          response.status,
          {
            endpoint: options.endpoint,
            status: response.status,
            statusText: response.statusText,
            body: this.sanitize(body),
          },
        );
      }

      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAtMs;

      if (error instanceof HttpException) {
        this.logger.warn(
          JSON.stringify({
            event: "sgp.request.failed",
            operation: options.operation,
            endpoint: options.endpoint,
            durationMs,
            error: error.getResponse(),
          }),
        );
        throw error;
      }

      const code = this.isAbortError(error) ? "SGP_TIMEOUT" : "SGP_UNAVAILABLE";
      const message =
        code === "SGP_TIMEOUT"
          ? `Tempo limite de ${timeoutMs}ms excedido ao consultar o SGP.`
          : "Não foi possível conectar ao SGP.";

      const exception = this.toHttpException(code, message, HttpStatus.BAD_GATEWAY, {
        endpoint: options.endpoint,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });

      this.logger.error(
        JSON.stringify({
          event: "sgp.request.failed",
          operation: options.operation,
          endpoint: options.endpoint,
          durationMs,
          error: exception.getResponse(),
        }),
      );

      throw exception;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestWithFallback(options: {
    operation: string;
    endpoints: string[];
    payload?: Record<string, unknown>;
  }) {
    let lastError: unknown;

    for (const endpoint of options.endpoints) {
      try {
        return await this.request({
          operation: options.operation,
          endpoint,
          payload: options.payload,
        });
      } catch (error) {
        lastError = error;
        if (!this.shouldTryNextEndpoint(error)) {
          throw error;
        }

        this.logger.warn(
          JSON.stringify({
            event: "sgp.discover-customers.fallback",
            failedEndpoint: endpoint,
            nextEndpointAvailable:
              options.endpoints.indexOf(endpoint) < options.endpoints.length - 1,
            error: error instanceof HttpException ? error.getResponse() : String(error),
          }),
        );
      }
    }

    throw lastError;
  }

  private buildAuthenticatedPayload(payload: Record<string, unknown> = {}) {
    const app = this.config.get<string>("SGP_APP");
    const token = this.config.get<string>("SGP_TOKEN");

    if (!app || !token) {
      throw this.toHttpException(
        "SGP_CONFIG_ERROR",
        "SGP_APP e SGP_TOKEN precisam estar configurados.",
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      app,
      token,
      ...payload,
    };
  }

  private buildUrl(endpoint: string) {
    const baseUrl = this.config.get<string>("SGP_API_URL");

    if (!baseUrl) {
      throw this.toHttpException(
        "SGP_CONFIG_ERROR",
        "SGP_API_URL precisa estar configurada.",
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
      const normalizedEndpoint = endpoint.startsWith("/")
        ? endpoint.slice(1)
        : endpoint;
      return new URL(normalizedEndpoint, normalizedBaseUrl);
    } catch {
      throw this.toHttpException(
        "SGP_INVALID_URL",
        "SGP_API_URL ou endpoint informado é inválido.",
        HttpStatus.BAD_REQUEST,
        { baseUrl: this.redactUrl(baseUrl), endpoint },
      );
    }
  }

  private getTimeoutMs() {
    const configuredTimeout = Number(this.config.get<string>("SGP_TIMEOUT_MS"));
    return Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS;
  }

  private async parseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private assertNotHtmlResponse(input: {
    body: unknown;
    endpoint: string;
    exactUrl: string;
    status: number;
    statusText: string;
  }) {
    if (typeof input.body !== "string") return;

    const normalized = input.body.trim().toLowerCase();
    if (!normalized.startsWith("<!doctype html") && !normalized.startsWith("<html")) {
      return;
    }

    const exception = this.toHttpException(
      "SGP_HTML_RESPONSE",
      `O SGP retornou HTML em vez de JSON. URL chamada: ${input.exactUrl}`,
      HttpStatus.BAD_GATEWAY,
      {
        endpoint: input.endpoint,
        exactUrl: input.exactUrl,
        status: input.status,
        statusText: input.statusText,
      },
    );

    this.logger.error(
      JSON.stringify({
        event: "sgp.response.html",
        message: "O SGP retornou HTML em vez de JSON.",
        endpoint: input.endpoint,
        exactUrl: input.exactUrl,
        status: input.status,
        statusText: input.statusText,
      }),
    );

    throw exception;
  }

  private sanitize(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          SENSITIVE_KEYS.has(key.toLowerCase()) ? this.maskSecret(item) : this.sanitize(item),
        ]),
      );
    }

    return value;
  }

  private maskSecret(value: unknown) {
    if (typeof value !== "string") return "[REDACTED]";
    if (value.length <= 4) return "[REDACTED]";
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }

  private redactUrl(url: string) {
    return url.replace(/(token|senha|password|secret)=([^&]+)/gi, "$1=[REDACTED]");
  }

  private isAbortError(error: unknown) {
    return (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"))
    );
  }

  private shouldTryNextEndpoint(error: unknown) {
    if (!(error instanceof HttpException)) return false;
    const response = error.getResponse();
    if (!response || typeof response !== "object") return false;

    const code = (response as { code?: string }).code;
    const context = (response as { context?: { status?: number } }).context;

    return (
      code === "SGP_HTML_RESPONSE" ||
      (code === "SGP_UNEXPECTED_RESPONSE" && context?.status === HttpStatus.NOT_FOUND)
    );
  }

  private toHttpException(
    code: SgpErrorCode,
    message: string,
    status: HttpStatus,
    context?: Record<string, unknown>,
  ) {
    return new HttpException(
      {
        code,
        message,
        context: context ? this.sanitize(context) : undefined,
      },
      status,
    );
  }
}
