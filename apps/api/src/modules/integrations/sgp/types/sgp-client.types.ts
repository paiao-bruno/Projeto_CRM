export type SgpDiscoveryRequest = {
  credentialId?: string;
  endpoint?: string;
  payload?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  pagination?: Record<string, unknown>;
  full?: boolean;
  mode?: "incremental" | "full";
};

export type SgpHttpResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
};

export type SgpErrorCode =
  | "SGP_CONFIG_ERROR"
  | "SGP_INVALID_URL"
  | "SGP_TIMEOUT"
  | "SGP_AUTH_FAILED"
  | "SGP_UNAVAILABLE"
  | "SGP_HTML_RESPONSE"
  | "SGP_UNEXPECTED_RESPONSE";

export type SgpRequestOptions = {
  endpoint: string;
  payload?: Record<string, unknown>;
  operation: string;
};
