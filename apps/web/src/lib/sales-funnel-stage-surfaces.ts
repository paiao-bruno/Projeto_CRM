import {
  SALES_FUNNEL_STAGE_CODES,
  type SalesFunnelStageCode,
} from "./sales-funnel.constants";

/**
 * Paleta de apresentação da jornada comercial (gráfico + cartões do funil).
 * Não persiste no banco e não substitui os tokens globais do tema.
 */
export const SALES_FUNNEL_STAGE_FILL = {
  [SALES_FUNNEL_STAGE_CODES.PROSPECCAO]: "#DC2626",
  [SALES_FUNNEL_STAGE_CODES.VIABILIDADE]: "#F87171",
  [SALES_FUNNEL_STAGE_CODES.NEGOCIACAO]: "#EAB308",
  [SALES_FUNNEL_STAGE_CODES.CONTRATO]: "#FDE68A",
  [SALES_FUNNEL_STAGE_CODES.AGENDAMENTO]: "#86EFAC",
  [SALES_FUNNEL_STAGE_CODES.ATIVACAO]: "#16A34A",
  [SALES_FUNNEL_STAGE_CODES.SUCESSO]: "#6366F1",
} as const satisfies Record<SalesFunnelStageCode, `#${string}`>;

export type SalesFunnelStageSurface = {
  fill: (typeof SALES_FUNNEL_STAGE_FILL)[SalesFunnelStageCode];
  text: "#FFFFFF" | "#081C2F" | "#000000";
  stroke: (typeof SALES_FUNNEL_STAGE_FILL)[SalesFunnelStageCode];
};

const TEXT_ON_FILL = {
  [SALES_FUNNEL_STAGE_CODES.PROSPECCAO]: "#FFFFFF",
  [SALES_FUNNEL_STAGE_CODES.VIABILIDADE]: "#081C2F",
  [SALES_FUNNEL_STAGE_CODES.NEGOCIACAO]: "#081C2F",
  [SALES_FUNNEL_STAGE_CODES.CONTRATO]: "#081C2F",
  [SALES_FUNNEL_STAGE_CODES.AGENDAMENTO]: "#081C2F",
  [SALES_FUNNEL_STAGE_CODES.ATIVACAO]: "#081C2F",
  [SALES_FUNNEL_STAGE_CODES.SUCESSO]: "#000000",
} as const satisfies Record<SalesFunnelStageCode, SalesFunnelStageSurface["text"]>;

export function salesFunnelStageSurface(
  code: string | null | undefined,
): SalesFunnelStageSurface | null {
  if (!code || !(code in SALES_FUNNEL_STAGE_FILL)) return null;
  const stageCode = code as SalesFunnelStageCode;
  const fill = SALES_FUNNEL_STAGE_FILL[stageCode];
  return { fill, text: TEXT_ON_FILL[stageCode], stroke: fill };
}
