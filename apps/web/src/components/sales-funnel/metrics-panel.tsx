"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SalesFunnelMetrics } from "@/lib/types";
import { formatCurrency } from "@/lib/sales-funnel-utils";
import { formatConversion } from "@/lib/payment-qualification";
import { FunnelVisualization } from "./funnel-visualization";
import { SegmentDonutChart } from "./segment-donut-chart";

type MetricsPanelProps = {
  metrics: SalesFunnelMetrics | null;
  loading?: boolean;
  onSelectStage?: (stageCode: string) => void;
};

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-400">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-white">{value}</p>
        {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function MetricsPanel({ metrics, loading = false, onSelectStage }: MetricsPanelProps) {
  if (loading) {
    return <p className="text-sm text-slate-400">Carregando indicadores...</p>;
  }

  if (!metrics) {
    return (
      <p className="text-sm text-slate-500">
        Indicadores indisponíveis no momento.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Oportunidades abertas" value={String(metrics.totals.open)} />
        <MetricCard label="Ativadas (status ganho)" value={String(metrics.totals.won)} />
        <MetricCard label="Perdidas" value={String(metrics.totals.lost)} />
        <MetricCard
          label="Conversão em ativação"
          value={formatConversion(metrics.totals.overallConversionRate)}
          hint={metrics.definitions.overallConversion}
        />
        <MetricCard
          label="Conversão em sucesso"
          value={formatConversion(metrics.totals.successConversionRate)}
          hint={metrics.definitions.successConversion}
        />
        <MetricCard
          label="Pagamento entre ativados"
          value={formatConversion(metrics.totals.paymentAmongActivatedRate)}
          hint={metrics.definitions.paymentAmongActivated}
        />
        <MetricCard
          label="Receita recebida (confirmações válidas)"
          value={formatCurrency(metrics.totals.receivedRevenueCents ?? 0)}
        />
        <MetricCard
          label="Valor estimado total"
          value={formatCurrency(metrics.totals.estimatedValueCents)}
        />
        <MetricCard
          label="Próxima ação atrasada"
          value={String(metrics.totals.overdueNextAction)}
        />
        <MetricCard
          label="Sem responsável"
          value={String(metrics.totals.withoutOwner)}
        />
        <MetricCard
          label="Criadas no período"
          value={String(metrics.totals.createdInPeriod)}
        />
      </div>

      <FunnelVisualization metrics={metrics} onSelectStage={onSelectStage} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SegmentDonutChart title="Meio de entrada" items={metrics.segments.entrySource} />
        <SegmentDonutChart title="Tipo de cliente" items={metrics.segments.clientType} />
        <SegmentDonutChart title="Tipo de contato" items={metrics.segments.contactType} />
        <SegmentDonutChart title="Vendedor" items={metrics.segments.owner} />
        <SegmentDonutChart title="Cidade" items={metrics.segments.city} />
        <SegmentDonutChart title="Bairro" items={metrics.segments.neighborhood} />
      </div>
    </div>
  );
}
