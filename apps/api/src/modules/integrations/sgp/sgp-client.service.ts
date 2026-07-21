import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { redactSensitiveData, safeJsonStringify } from "../../../security/utils/redact-sensitive.util";
import {
  SgpErrorCode,
  SgpHttpResponse,
  SgpRequestOptions,
} from "./types/sgp-client.types";
import { SgpRuntimeCredentials } from "./types/sgp-credentials.types";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CUSTOMER_DISCOVERY_ENDPOINT = "/api/ura/consultacliente/";
const OFFICIAL_CUSTOMERS_LIST_ENDPOINT = "/api/ura/clientes/";
const OFFICIAL_CONTRACTS_LIST_ENDPOINT = "/api/contrato/list/";
const OFFICIAL_TITLES_LIST_ENDPOINT = "/api/ura/titulos/";

@Injectable()
export class SgpClientService {
  private readonly logger = new Logger(SgpClientService.name);

  testAuth(
    credentials: SgpRuntimeCredentials,
    payload?: Record<string, unknown>,
    endpoint?: string,
  ) {
    return this.request(credentials, {
      operation: "sgp.test-auth",
      endpoint: endpoint ?? DEFAULT_CUSTOMER_DISCOVERY_ENDPOINT,
      payload,
    });
  }

  discoverCustomers(
    credentials: SgpRuntimeCredentials,
    payload?: Record<string, unknown>,
  ) {
    return this.request(credentials, {
      operation: "sgp.discover-customers",
      endpoint: OFFICIAL_CUSTOMERS_LIST_ENDPOINT,
      payload,
    });
  }

  discoverContracts(
    credentials: SgpRuntimeCredentials,
    payload?: Record<string, unknown>,
  ) {
    return this.request(credentials, {
      operation: "sgp.discover-contracts",
      endpoint: OFFICIAL_CONTRACTS_LIST_ENDPOINT,
      payload,
    });
  }

  discoverTitles(
    credentials: SgpRuntimeCredentials,
    payload?: Record<string, unknown>,
  ) {
    return this.request(credentials, {
      operation: "sgp.discover-titles",
      endpoint: OFFICIAL_TITLES_LIST_ENDPOINT,
      payload,
    });
  }

  debug(
    credentials: SgpRuntimeCredentials,
    endpoint: string,
    payload?: Record<string, unknown>,
  ) {
    return this.request(credentials, {
      operation: "sgp.debug",
      endpoint,
      payload,
    });
  }

  async request(
    credentials: SgpRuntimeCredentials,
    options: SgpRequestOptions,
  ): Promise<SgpHttpResponse> {
    const startedAt = new Date();
    const startedAtMs = Date.now();
    const controller = new AbortController();
    const timeoutMs = this.getTimeoutMs(credentials);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = this.buildUrl(credentials, options.endpoint);
      const payload = this.buildAuthenticatedPayload(credentials, options.payload);

      this.logger.log(
        safeJsonStringify({
          event: "sgp.request.started",
          operation: options.operation,
          endpoint: options.endpoint,
          url: this.redactUrl(url.toString()),
          startedAt: startedAt.toISOString(),
          timeoutMs,
          payload,
        }),
      );

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${credentials.token}`,
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
        safeJsonStringify({
          event: "sgp.request.finished",
          operation: options.operation,
          endpoint: options.endpoint,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          response: this.summarizeResponse(body),
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
            body: redactSensitiveData(body),
          },
        );
      }

      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAtMs;

      if (error instanceof HttpException) {
        this.logger.warn(
          safeJsonStringify({
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
        safeJsonStringify({
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

  private buildAuthenticatedPayload(
    credentials: SgpRuntimeCredentials,
    payload: Record<string, unknown> = {},
  ) {
    return {
      app: credentials.app,
      token: credentials.token,
      ...payload,
    };
  }

  private buildUrl(credentials: SgpRuntimeCredentials, endpoint: string) {
    const baseUrl = credentials.apiUrl.trim();

    if (!baseUrl) {
      throw this.toHttpException(
        "SGP_CONFIG_ERROR",
        "A URL da API SGP precisa estar configurada.",
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const normalizedEndpoint = this.normalizeApiEndpoint(endpoint);
      const url = endpoint.startsWith("http://") || endpoint.startsWith("https://")
        ? new URL(normalizedEndpoint)
        : new URL(
            normalizedEndpoint,
            baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
          );

      if (credentials.apiPort && !url.port) {
        url.port = credentials.apiPort;
      }

      return url;
    } catch {
      throw this.toHttpException(
        "SGP_INVALID_URL",
        "A URL da API SGP ou endpoint informado é inválido.",
        HttpStatus.BAD_REQUEST,
        { baseUrl: this.redactUrl(baseUrl), endpoint },
      );
    }
  }

  private normalizeApiEndpoint(endpoint: string) {
    const trimmedEndpoint = endpoint.trim();

    if (trimmedEndpoint.startsWith("http://") || trimmedEndpoint.startsWith("https://")) {
      const url = new URL(trimmedEndpoint);
      url.pathname = this.ensureApiPath(url.pathname);
      return url.toString();
    }

    return this.ensureApiPath(trimmedEndpoint);
  }

  private ensureApiPath(endpoint: string) {
    const withLeadingSlash = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

    if (withLeadingSlash === "/api" || withLeadingSlash.startsWith("/api/")) {
      return withLeadingSlash;
    }

    if (withLeadingSlash === "/") {
      return "/api/";
    }

    return `/api${withLeadingSlash}`;
  }

  private getTimeoutMs(credentials: SgpRuntimeCredentials) {
    const configuredTimeout = Number(credentials.timeoutMs);
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
      safeJsonStringify({
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

  private summarizeResponse(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return body;
    }

    const record = body as Record<string, unknown>;
    const listKeys = ["clientes", "contratos", "titulos", "títulos", "data", "items", "results"];
    const counts = Object.fromEntries(
      listKeys
        .filter((key) => Array.isArray(record[key]))
        .map((key) => [key, (record[key] as unknown[]).length]),
    );

    return {
      keys: Object.keys(record).slice(0, 20),
      counts,
      pagination: {
        offset: record.offset,
        limit: record.limit,
        total: record.total,
        page: record.page ?? record.pagina,
        parcial: record.parcial ?? record.partial,
      },
    };
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
        context: context ? redactSensitiveData(context) : undefined,
      },
      status,
    );
  }
}
