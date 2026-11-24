export const CAMPAIGN_CHANNELS = ["LOCAL", "WHATSAPP", "EMAIL", "ADS", "OTHER"] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "CANCELED",
  "FAILED",
] as const;

export const CAMPAIGN_STATUS_LABELS: Record<(typeof CAMPAIGN_STATUSES)[number], string> = {
  DRAFT: "Rascunho",
  SCHEDULED: "Agendada",
  RUNNING: "Em envio",
  PAUSED: "Pausada",
  COMPLETED: "Concluída",
  CANCELED: "Cancelada",
  FAILED: "Falhou",
};

export const CAMPAIGN_CHANNEL_LABELS: Record<CampaignChannel, string> = {
  LOCAL: "Cadastro local",
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
  ADS: "Anúncios",
  OTHER: "Outro",
};

export const DEFAULT_SALE_ORIGINS = [
  "Indicação",
  "Site",
  "Instagram",
  "Facebook",
  "Google",
  "Prospecção ativa",
  "Cliente antigo",
] as const;

export function normalizeOriginName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

export function originNameKey(name: string) {
  return normalizeOriginName(name).toLocaleLowerCase("pt-BR");
}

export const AD_CHANNELS = [
  {
    id: "google-ads-search",
    name: "Google Ads — Pesquisa",
    originName: "Google Ads Pesquisa",
    summary:
      "Anúncios de texto na pesquisa Google. Útil para captar quem já busca o serviço. Exige conta Google Ads e palavras-chave; o resultado depende de lance, qualidade do anúncio e concorrência.",
    href: "https://support.google.com/google-ads/answer/2567043?hl=pt-BR",
  },
  {
    id: "google-shopping",
    name: "Google Shopping",
    originName: "Google Shopping",
    summary:
      "Exibe produtos com imagem, preço e loja nos resultados. Adequado a catálogos; exige Merchant Center e feed atualizado.",
    href: "https://support.google.com/google-ads/answer/2454022?hl=pt-BR",
  },
  {
    id: "display",
    name: "Rede de Display",
    originName: "Google Display",
    summary:
      "Banners em sites e apps da rede Google. Serve a lembrança de marca e remarketing; não substitui a pesquisa de intenção.",
    href: "https://support.google.com/google-ads/answer/2404190?hl=pt-BR",
  },
  {
    id: "youtube-ads",
    name: "YouTube Ads",
    originName: "YouTube Ads",
    summary:
      "Vídeo in-stream, shorts e outros formatos no YouTube. Requer criativos em vídeo e definição de público; o custo varia por leilão.",
    href: "https://support.google.com/google-ads/answer/2375413?hl=pt-BR",
  },
  {
    id: "seo",
    name: "SEO orgânico",
    originName: "SEO orgânico",
    summary:
      "Melhora a visibilidade em buscas sem pagamento por clique. Segue diretrizes de conteúdo útil, páginas rápidas e rastreáveis; os efeitos são graduais.",
    href: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide?hl=pt-BR",
  },
  {
    id: "pmax",
    name: "Performance Max",
    originName: "Performance Max",
    summary:
      "Campanha baseada em objetivos que distribui criativos em vários inventários Google. Depende de conversões bem medidas e não garante posição ou retorno.",
    href: "https://support.google.com/google-ads/answer/10724817?hl=pt-BR",
  },
] as const;
