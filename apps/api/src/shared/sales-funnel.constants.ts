/**
 * Fonte canônica: shared/sales-funnel.constants.ts
 * Gerado por scripts/sync-shared-constants.mjs
 */
export const SALES_FUNNEL_PIPELINE_NAME = "Funil de Vendas";

export const SALES_FUNNEL_STAGE_CODES = {
  PROSPECCAO: "PROSPECCAO",
  VIABILIDADE: "VIABILIDADE",
  NEGOCIACAO: "NEGOCIACAO",
  CONTRATO: "CONTRATO",
  AGENDAMENTO: "AGENDAMENTO",
  ATIVACAO: "ATIVACAO",
} as const;

export type SalesFunnelStageCode =
  (typeof SALES_FUNNEL_STAGE_CODES)[keyof typeof SALES_FUNNEL_STAGE_CODES];

export const SALES_FUNNEL_STAGES: ReadonlyArray<{
  code: SalesFunnelStageCode;
  name: string;
  position: number;
  color: string;
}> = [
  { code: SALES_FUNNEL_STAGE_CODES.PROSPECCAO, name: "Prospecção", position: 1, color: "#64748b" },
  { code: SALES_FUNNEL_STAGE_CODES.VIABILIDADE, name: "Viabilidade", position: 2, color: "#0ea5e9" },
  { code: SALES_FUNNEL_STAGE_CODES.NEGOCIACAO, name: "Negociação", position: 3, color: "#f59e0b" },
  { code: SALES_FUNNEL_STAGE_CODES.CONTRATO, name: "Contrato", position: 4, color: "#8b5cf6" },
  { code: SALES_FUNNEL_STAGE_CODES.AGENDAMENTO, name: "Agendamento", position: 5, color: "#06b6d4" },
  { code: SALES_FUNNEL_STAGE_CODES.ATIVACAO, name: "Ativação", position: 6, color: "#22c55e" },
];

export const SALES_FUNNEL_FIELD_LIMITS = {
  title: 200,
  phone: 30,
  email: 320,
  clientType: 80,
  entrySource: 80,
  contactType: 80,
  city: 120,
  neighborhood: 120,
  nextAction: 500,
  notes: 5000,
  lossReason: 500,
} as const;

export const SALES_FUNNEL_METRICS_DOC = {
  overallConversion:
    "Conversão geral = oportunidades que chegaram à Ativação ÷ oportunidades criadas no período.",
  stageConversion:
    "Taxa entre etapas = oportunidades que atingiram a etapa seguinte ÷ oportunidades que atingiram a etapa anterior.",
} as const;
