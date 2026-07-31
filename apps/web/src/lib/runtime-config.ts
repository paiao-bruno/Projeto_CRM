export function isWebOnlyMode(
  env: Record<string, string | undefined> = process.env,
) {
  return env.NEXT_PUBLIC_WEB_ONLY_MODE === "true";
}

export function resolveApiBaseUrl(
  env: Record<string, string | undefined> = process.env,
) {
  if (isWebOnlyMode(env)) return "/api";
  const configured = env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) return configured;
  return "http://localhost:4000/api";
}

export const LEGACY_API_UNAVAILABLE_MESSAGE =
  "Esta página depende da API NestJS (apps/api), que está temporariamente desligada. " +
  "Use o Funil de Vendas ou reative a API com npm run dev ou npm run dev:funnel.";

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
