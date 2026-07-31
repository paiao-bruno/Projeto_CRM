/**
 * Configuração de runtime do frontend.
 * IMPORTANTE: use acesso DIRETO a process.env.NEXT_PUBLIC_* para o Next.js
 * inlined corretamente no bundle do navegador.
 */

export const LEGACY_API_UNAVAILABLE_MESSAGE =
  "Esta página depende da API NestJS (apps/api), que está temporariamente desligada. " +
  "Use o Funil de Vendas ou reative a API com npm run dev ou npm run dev:funnel.";

/** Inline-friendly — reflete o valor compilado no cliente. */
export function isWebOnlyMode(): boolean {
  return process.env.NEXT_PUBLIC_WEB_ONLY_MODE === "true";
}

/** Resolução determinística da base URL da API no cliente e no servidor. */
export function resolveApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_WEB_ONLY_MODE === "true") {
    return "/api";
  }
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    return configured;
  }
  return "http://localhost:4000/api";
}

/** Variante para testes unitários com env explícito. */
export function resolveApiBaseUrlFromEnv(env: Record<string, string | undefined>): string {
  if (env.NEXT_PUBLIC_WEB_ONLY_MODE === "true") {
    return "/api";
  }
  const configured = env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    return configured;
  }
  return "http://localhost:4000/api";
}

export function isWebOnlyModeFromEnv(env: Record<string, string | undefined>): boolean {
  return env.NEXT_PUBLIC_WEB_ONLY_MODE === "true";
}

export function isLegacyApiRoute(path: string) {
  return (
    path.startsWith("/customers") ||
    path.startsWith("/contracts") ||
    path.startsWith("/invoices") ||
    path.startsWith("/integrations") ||
    path.startsWith("/dashboard") ||
    path.startsWith("/ai-agents") ||
    path.startsWith("/chat")
  );
}
