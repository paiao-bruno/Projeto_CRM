export const SALES_FUNNEL_PIPELINE_NAME = "Funil de Vendas";

export const SALES_FUNNEL_STAGE_CODES = {
  PROSPECCAO: "PROSPECCAO",
  VIABILIDADE: "VIABILIDADE",
  NEGOCIACAO: "NEGOCIACAO",
  CONTRATO: "CONTRATO",
  AGENDAMENTO: "AGENDAMENTO",
  ATIVACAO: "ATIVACAO",
  SUCESSO: "SUCESSO",
} as const;

export type SalesFunnelStageCode =
  (typeof SALES_FUNNEL_STAGE_CODES)[keyof typeof SALES_FUNNEL_STAGE_CODES];

export const SALES_FUNNEL_STAGES: ReadonlyArray<{
  code: SalesFunnelStageCode;
  name: string;
  position: number;
  color: string;
  description?: string;
}> = [
  { code: SALES_FUNNEL_STAGE_CODES.PROSPECCAO, name: "Prospecção", position: 1, color: "#243B53" },
  { code: SALES_FUNNEL_STAGE_CODES.VIABILIDADE, name: "Viabilidade", position: 2, color: "#3A5A78" },
  { code: SALES_FUNNEL_STAGE_CODES.NEGOCIACAO, name: "Negociação", position: 3, color: "#C9A227" },
  { code: SALES_FUNNEL_STAGE_CODES.CONTRATO, name: "Contrato", position: 4, color: "#8FA4B8" },
  { code: SALES_FUNNEL_STAGE_CODES.AGENDAMENTO, name: "Agendamento", position: 5, color: "#4F7A9A" },
  { code: SALES_FUNNEL_STAGE_CODES.ATIVACAO, name: "Ativação", position: 6, color: "#3D7A5A" },
  {
    code: SALES_FUNNEL_STAGE_CODES.SUCESSO,
    name: "Sucesso",
    position: 7,
    color: "#D4AF37",
    description: "Primeiro pagamento confirmado",
  },
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
  paymentReference: 120,
} as const;

export const SALES_FUNNEL_METRICS_DOC = {
  overallConversion:
    "Conversão em ativação = oportunidades distintas que chegaram à Ativação ÷ oportunidades criadas no período.",
  successConversion:
    "Conversão em sucesso = oportunidades distintas que chegaram a Sucesso com pagamento qualificável válido ÷ oportunidades criadas no período.",
  paymentAmongActivated:
    "Taxa de pagamento qualificável = sucessos válidos no período ÷ ativações no período.",
  stageConversion:
    "Taxa entre etapas (estoque atual) = oportunidades abertas na etapa seguinte ÷ oportunidades abertas na etapa anterior. Não reconstrói coorte histórica.",
  funnelGeometry:
    "A largura das faixas é esquemática da jornada. As quantidades e taxas exibidas são os dados reais.",
} as const;
