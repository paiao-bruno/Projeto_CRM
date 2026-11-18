"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SalesFunnelMetrics } from "@/lib/types";
import { SALES_FUNNEL_METRICS_DOC, SALES_FUNNEL_STAGES } from "@/lib/sales-funnel.constants";
import { salesFunnelStageSurface } from "@/lib/sales-funnel-stage-surfaces";
import { formatConversion } from "@/lib/payment-qualification";
import { formatPercent } from "@/lib/sales-funnel-utils";

type FunnelVisualizationProps = {
  metrics: SalesFunnelMetrics;
  onSelectStage?: (stageCode: string) => void;
};

const BANDS = SALES_FUNNEL_STAGES.length;
const TOP_WIDTH = 100;
const BOTTOM_WIDTH = 42;
const BAND_HEIGHT = 46;
const GAP = 6;

function bandWidth(index: number) {
  if (BANDS <= 1) return TOP_WIDTH;
  return TOP_WIDTH - ((TOP_WIDTH - BOTTOM_WIDTH) * index) / (BANDS - 1);
}

export function FunnelVisualization({ metrics, onSelectStage }: FunnelVisualizationProps) {
  const viewWidth = 640;
  const viewHeight = BANDS * (BAND_HEIGHT + GAP) + 8;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funil por etapa</CardTitle>
        <p className="mt-1 text-xs text-slate-400">{SALES_FUNNEL_METRICS_DOC.funnelGeometry}</p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
          <div>
            <svg
              role="img"
              aria-label="Funil comercial esquemático com sete etapas"
              viewBox={`0 0 ${viewWidth} ${viewHeight}`}
              className="h-auto w-full"
            >
              {SALES_FUNNEL_STAGES.map((definition, index) => {
                const stage = metrics.byStage.find((item) => item.code === definition.code);
                const count = stage?.count ?? 0;
                const top = bandWidth(index);
                const bottom = bandWidth(Math.min(index + 1, BANDS - 1));
                const y = index * (BAND_HEIGHT + GAP);
                const topX = (100 - top) / 2;
                const bottomX = (100 - bottom) / 2;
                const toX = (pct: number) => (pct / 100) * viewWidth;
                const points = [
                  `${toX(topX)},${y}`,
                  `${toX(topX + top)},${y}`,
                  `${toX(bottomX + bottom)},${y + BAND_HEIGHT}`,
                  `${toX(bottomX)},${y + BAND_HEIGHT}`,
                ].join(" ");
                const label = `${definition.name}${definition.description ? ` — ${definition.description}` : ""}`;
                const surface = salesFunnelStageSurface(definition.code);
                const fill = surface?.fill ?? definition.color;
                const stroke = surface?.stroke ?? definition.color;
                const labelFill = surface?.text ?? "var(--vx-text)";

                return (
                  <g key={definition.code}>
                    <polygon
                      points={points}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth="1.5"
                      className={onSelectStage ? "cursor-pointer" : undefined}
                      onClick={() => onSelectStage?.(definition.code)}
                    />
                    <text
                      x={viewWidth / 2}
                      y={y + BAND_HEIGHT / 2 + 4}
                      textAnchor="middle"
                      fill={labelFill}
                      fontSize={index >= 5 ? 12 : 14}
                      fontWeight={700}
                      className={onSelectStage ? "cursor-pointer" : undefined}
                      onClick={() => onSelectStage?.(definition.code)}
                    >
                      {label} · {count}
                    </text>
                  </g>
                );
              })}
            </svg>
            <table className="vx-table mt-4">
              <caption className="mb-2 text-left text-xs vx-muted">Quantidades reais por etapa (a largura do desenho é esquemática)</caption>
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Quantidade</th>
                </tr>
              </thead>
              <tbody>
                {SALES_FUNNEL_STAGES.map((definition) => {
                  const stage = metrics.byStage.find((item) => item.code === definition.code);
                  return (
                    <tr key={definition.code}>
                      <td>
                        <button
                          type="button"
                          className="text-left underline decoration-transparent hover:decoration-current"
                          onClick={() => onSelectStage?.(definition.code)}
                        >
                          {definition.name}
                          {definition.description ? ` (${definition.description})` : ""}
                        </button>
                      </td>
                      <td>{stage?.count ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-emerald-300">Conversão em ativação</p>
              <p className="mt-1 text-2xl font-bold text-emerald-300">
                {formatConversion(metrics.totals.overallConversionRate)}
              </p>
              <p className="mt-1 text-xs text-slate-400">{metrics.definitions.overallConversion}</p>
            </div>
            <div className="rounded-2xl border px-4 py-3" style={{ borderColor: "var(--vx-primary)" }}>
              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--vx-primary)" }}>
                Conversão em sucesso
              </p>
              <p className="mt-1 text-2xl font-bold" style={{ color: "var(--vx-primary)" }}>
                {formatConversion(metrics.totals.successConversionRate)}
              </p>
              <p className="mt-1 text-xs text-slate-400">{metrics.definitions.successConversion}</p>
            </div>
            <p className="text-sm font-semibold text-white">Conversão entre etapas</p>
            <p className="text-xs text-slate-500">{metrics.definitions.stageConversion}</p>
            {metrics.stageConversion.map((item) => (
              <div
                key={`${item.from}-${item.to}`}
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm"
              >
                <span className="text-slate-400">
                  {item.from} → {item.to}
                </span>
                <span className="font-semibold text-white">{formatPercent(item.rate) === "—" ? "sem base" : formatPercent(item.rate)}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
