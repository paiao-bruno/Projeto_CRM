/**
 * O site é único: toda chamada de dados vai para as rotas Next em /api (mesma origem).
 * Nenhum servidor adicional participa do fluxo padrão.
 */
export function resolveApiBaseUrl(): string {
  return "/api";
}
