import {
  SALES_FUNNEL_STAGE_CODES,
  SALES_FUNNEL_STAGES,
  type SalesFunnelStageCode,
} from "./sales-funnel.constants";

/**
 * Paleta de apresentação da jornada comercial.
 * Um hexadecimal por código estável alimenta três aplicações independentes:
 * preenchimento da faixa, borda do cartão e linha superior da coluna.
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

function surfaceFor(stageCode: SalesFunnelStageCode): SalesFunnelStageSurface {
  const fill = SALES_FUNNEL_STAGE_FILL[stageCode];
  return { fill, text: TEXT_ON_FILL[stageCode], stroke: fill };
}

export function salesFunnelStageSurface(
  code: string | null | undefined,
  canonicalName?: string | null,
): SalesFunnelStageSurface | null {
  if (code && code in SALES_FUNNEL_STAGE_FILL) {
    return surfaceFor(code as SalesFunnelStageCode);
  }
  if (canonicalName) {
    const match = SALES_FUNNEL_STAGES.find((stage) => stage.name === canonicalName);
    if (match) return surfaceFor(match.code);
  }
  return null;
}

/** Hexadecimal da etapa para borda do cartão, linha da coluna ou preenchimento da faixa. */
export function salesFunnelStageAccent(
  code?: string | null,
  canonicalName?: string | null,
): SalesFunnelStageSurface["stroke"] | null {
  return salesFunnelStageSurface(code, canonicalName)?.stroke ?? null;
}
