"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SalesFunnelMetrics } from "@/lib/types";
import { SALES_FUNNEL_STAGES } from "@/lib/sales-funnel.constants";
import { formatPercent } from "@/lib/sales-funnel-utils";

type FunnelVisualizationProps = {
  metrics: SalesFunnelMetrics;
};

export function FunnelVisualization({ metrics }: FunnelVisualizationProps) {
  const maxCount = Math.max(...metrics.byStage.map((stage) => stage.count), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funil por etapa</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
          <div className="space-y-2">
            {SALES_FUNNEL_STAGES.map((definition, index) => {
              const stage = metrics.byStage.find((item) => item.code === definition.code);
              const count = stage?.count ?? 0;
              const width = Math.max(28, (count / maxCount) * 100);
              const conversion = metrics.stageConversion[index];

              return (
                <div key={definition.code} className="relative">
                  <div
                    className="mx-auto flex items-center justify-between rounded-xl px-4 py-3 text-sm font-medium text-white transition-all"
                    style={{
                      width: `${width}%`,
                      minWidth: "220px",
                      backgroundColor: `${definition.color}33`,
                      border: `1px solid ${definition.color}88`,
                    }}
                  >
                    <span>{definition.name}</span>
                    <span className="rounded-full bg-slate-950/50 px-2.5 py-1 text-xs font-bold">
                      {count}
                    </span>
                  </div>
                </div>
              );
            })}

            <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-center">
              <p className="text-xs uppercase tracking-wide text-emerald-300/80">
                Conversão geral
              </p>
              <p className="mt-1 text-2xl font-bold text-emerald-300">
                {formatPercent(metrics.totals.overallConversionRate)}
              </p>
              <p className="mt-1 text-xs text-slate-400">{metrics.definitions.overallConversion}</p>
            </div>
          </div>

          <div className="space-y-3">
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
                <span className="font-semibold text-white">{formatPercent(item.rate)}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
