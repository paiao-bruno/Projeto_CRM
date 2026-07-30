import { HttpException } from "@nestjs/common";
import { describeSgpPayload, SgpPayloadShape } from "./sgp-response-parser";

export type SgpSyncFailureDetails = {
  message: string;
  errorCode?: string;
  httpStatus?: number;
  stage?: string;
  entity?: string;
  endpoint?: string;
  method?: string;
  contentType?: string;
  responseShape?: SgpPayloadShape;
  stackTrace?: string;
};

export function extractHttpErrorMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === "string" && response.trim()) {
      return response;
    }
    if (response && typeof response === "object") {
      const record = response as Record<string, unknown>;
      const message = record.message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
      if (Array.isArray(message)) {
        return message.filter((item) => typeof item === "string").join("; ");
      }
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return String(error);
}

export function extractHttpErrorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) {
    return undefined;
  }

  const response = error.getResponse();
  if (response && typeof response === "object") {
    const code = (response as Record<string, unknown>).code;
    if (typeof code === "string") {
      return code;
    }
  }

  return undefined;
}

export function extractHttpErrorContext(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof HttpException)) {
    return undefined;
  }

  const response = error.getResponse();
  if (response && typeof response === "object") {
    const context = (response as Record<string, unknown>).context;
    if (context && typeof context === "object" && !Array.isArray(context)) {
      return context as Record<string, unknown>;
    }
  }

  return undefined;
}

export function sanitizeStackTrace(stack?: string): string | undefined {
  if (!stack) {
    return undefined;
  }

  return stack
    .split("\n")
    .slice(0, 12)
    .map((line) => line.replace(/(token|app|senha|password|secret)=[^&\s]+/gi, "$1=[REDACTED]"))
    .join("\n");
}

export function buildSgpSyncFailureDetails(
  error: unknown,
  fallback: Omit<SgpSyncFailureDetails, "message"> = {},
): SgpSyncFailureDetails {
  const context = extractHttpErrorContext(error);
  const responseShape =
    fallback.responseShape ??
    (context?.responseShape && typeof context.responseShape === "object"
      ? (context.responseShape as SgpPayloadShape)
      : undefined);

  return {
    message: extractHttpErrorMessage(error),
    errorCode:
      fallback.errorCode ??
      extractHttpErrorCode(error) ??
      (typeof context?.code === "string" ? context.code : undefined),
    httpStatus:
      fallback.httpStatus ??
      (typeof context?.status === "number" ? context.status : undefined) ??
      (error instanceof HttpException ? error.getStatus() : undefined),
    stage: fallback.stage ?? (typeof context?.stage === "string" ? context.stage : undefined),
    entity: fallback.entity ?? (typeof context?.entity === "string" ? context.entity : undefined),
    endpoint:
      fallback.endpoint ?? (typeof context?.endpoint === "string" ? context.endpoint : undefined),
    method: fallback.method ?? (typeof context?.method === "string" ? context.method : "POST"),
    contentType:
      fallback.contentType ??
      (typeof context?.contentType === "string" ? context.contentType : undefined),
    responseShape,
    stackTrace: sanitizeStackTrace(
      fallback.stackTrace ?? (error instanceof Error ? error.stack : undefined),
    ),
  };
}

export function buildInvalidSgpPayloadFailure(input: {
  stage: string;
  entity: string;
  endpoint: string;
  method?: string;
  httpStatus?: number;
  contentType?: string;
  body: unknown;
  offset?: number;
  limit?: number;
  technicalMessage: string;
}): SgpSyncFailureDetails {
  return {
    message: input.technicalMessage,
    errorCode: "SGP_INVALID_RESPONSE_SHAPE",
    httpStatus: input.httpStatus ?? 200,
    stage: input.stage,
    entity: input.entity,
    endpoint: input.endpoint,
    method: input.method ?? "POST",
    contentType: input.contentType,
    responseShape: describeSgpPayload(input.body),
    stackTrace: undefined,
  };
}
