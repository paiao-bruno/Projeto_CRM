"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { ErrorAlert, Field, formatCents, PageHeader, useResource } from "@/components/vx";
import { api } from "@/lib/api";
import { formatChangeLabel } from "@/lib/dashboard-commercial-metrics";
import { useAuth } from "@/components/auth-provider";

type Change = { kind: "pct" | "none"; value: number | null };

type CommercialResponse = {
  generatedAt: string;
  timeZone: string;
  referenceYmd: string;
  period: {
    fromYmd: string;
    toYmdInclusive: string;
    preset: string;
    comparisonKind: string;
    comparisonLabel: string;
    previousFromYmd: string;
    previousToYmdInclusive: string;
  };
  coverage: {
    conversionSource: string;
    paymentConfirmedRevenue: boolean;
    paymentNote: string;
    cancellations: string;
    identityReliable: boolean;
    historyStartsFrom: string | null;
    ltv: boolean;
  };
  cards: {
    base: { label: string; hint: string; value: number; change: Change; available: boolean };
    created: { label: string; hint: string; value: number; change: Change; available: boolean };
    finance: {
      label: string;
      hint: string;
      valueCents: number | null;
      missing: number;
      available: boolean;
      unavailableReason: string | null;
    };
    newConversions: { label: string; hint: string; value: number; change: Change; available: boolean };
    conversionRate: {
      label: string;
      hint: string;
      rate: number | null;
      created: number;
      converted: number;
      deltaPoints: number | null;
      available: boolean;
    };
  };
  horizons: Array<{
    kind: string;
    label: string;
    fromYmd: string;
    toYmdInclusive: string;
    unit: string;
    realized: number;
    target: number | null;
    fulfillment: number | null;
    deviation: number | null;
    ring: number;
  }>;
  cancellations: {
    available: boolean;
    quantity: number | null;
    rate: number | null;
    quantityChange: Change;
    rateDeltaPoints: number | null;
    series: Array<{ closeYmd: string; label: string; quantity: number | null; partial: boolean }>;
    reason: string | null;
  };
  baseEvolution: {
    realizedMetric: string;
    targetMetric: string;
    months: Array<{ closeYmd: string; label: string; realized: number; target: number | null; partial: boolean }>;
  };
  planMix: {
    available: boolean;
    unit: string;
    total: number;
    slices: Array<{ name: string; count: number; share: number }>;
    reason: string | null;
  };
  insights: Array<{ id: string; text: string }>;
  strategic: { target: number; realized: number; message: string; onTrack: boolean | null } | null;
};

const MIX_COLORS = ["#D4AF37", "#243B53", "#3D7A5A", "#4F7A9A", "#8FA4B8", "#C4BFA8"];

function pct(value: number | null) {
  if (value == null) return "Sem amostra";
  return `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function GoalRing({ value }: { value: number }) {
  const radius = 36;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - Math.min(1, Math.max(0, value)));
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
      <circle cx="48" cy="48" r={radius} fill="none" stroke="var(--vx-border)" strokeWidth="8" />
      <circle
        cx="48"
        cy="48"
        r={radius}
        fill="none"
        stroke="var(--vx-secondary)"
        strokeWidth="8"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 48 48)"
      />
    </svg>
  );
}

export function CommercialDashboard() {
  const { token } = useAuth();
  const [preset, setPreset] = useState("month_to_date");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [goalKind, setGoalKind] = useState("monthly");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalError, setGoalError] = useState("");
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (preset === "custom" && from && to) {
      params.set("from", from);
      params.set("to", to);
    } else {
      params.set("preset", preset);
    }
    return `/dashboard/commercial?${params.toString()}`;
  }, [preset, from, to]);
  const { data, error, loading, reload } = useResource<CommercialResponse>(query);

  async function saveGoal(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setGoalError("");
    try {
      const metric = goalKind === "base_stock" ? "base_stock" : "new_conversions";
      await api.patch("/dashboard/goals", { kind: goalKind, metric, targetValue: Number(goalTarget) }, token);
      await reload();
      setGoalTarget("");
    } catch (err) {
      setGoalError(err instanceof Error ? err.message : "Não foi possível salvar a meta.");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard Comercial"
        subtitle="Crescimento, performance e resultados em um só lugar!"
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="sr-only">Atalho de período</span>
              <select
                className="vx-input"
                value={preset}
                onChange={(event) => setPreset(event.target.value)}
                aria-label="Período"
              >
                <option value="month_to_date">Mês corrente</option>
                <option value="7d">Últimos 7 dias</option>
                <option value="30d">Últimos 30 dias</option>
                <option value="90d">Últimos 90 dias</option>
                <option value="custom">Personalizado</option>
              </select>
            </label>
            {preset === "custom" ? (
              <>
                <input className="vx-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Data inicial" />
                <input className="vx-input" type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="Data final" />
              </>
            ) : null}
            <Button variant="secondary" onClick={() => void reload()}>
              Atualizar
            </Button>
          </div>
        }
      />
      <ErrorAlert message={error} />
      {loading && !data ? <p className="vx-empty">Carregando indicadores comerciais...</p> : null}
      {data ? (
        <>
          <p className="text-xs vx-muted">
            Fuso {data.timeZone} · {data.period.fromYmd} a {data.period.toYmdInclusive} · {data.period.comparisonLabel} ·
            atualizado em {new Date(data.generatedAt).toLocaleString("pt-BR", { timeZone: data.timeZone })}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard title={data.cards.base.label} hint={data.cards.base.hint} value={data.cards.base.value.toLocaleString("pt-BR")} change={formatChangeLabel(data.cards.base.change)} />
            <SummaryCard title={data.cards.created.label} hint={data.cards.created.hint} value={data.cards.created.value.toLocaleString("pt-BR")} change={formatChangeLabel(data.cards.created.change)} />
            <SummaryCard
              title={data.cards.finance.label}
              hint={data.cards.finance.hint}
              value={data.cards.finance.available && data.cards.finance.valueCents != null ? formatCents(data.cards.finance.valueCents) : data.cards.finance.unavailableReason ?? "Indisponível"}
            />
            <SummaryCard title={data.cards.newConversions.label} hint={data.cards.newConversions.hint} value={data.cards.newConversions.value.toLocaleString("pt-BR")} change={formatChangeLabel(data.cards.newConversions.change)} />
            <SummaryCard
              title={data.cards.conversionRate.label}
              hint={data.cards.conversionRate.hint}
              value={data.cards.conversionRate.available ? pct(data.cards.conversionRate.rate) : "Sem amostra"}
              change={
                data.cards.conversionRate.deltaPoints == null
                  ? "Sem base de comparação"
                  : `${data.cards.conversionRate.deltaPoints >= 0 ? "+" : ""}${data.cards.conversionRate.deltaPoints.toFixed(1)} p.p.`
              }
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <section className="vx-card p-4">
              <h2 className="font-bold">Indicadores de Crescimento</h2>
              <p className="mt-1 text-xs vx-muted">
                Mesma métrica em todos os anéis: {data.coverage.identityReliable ? "novos clientes convertidos" : "novas conversões do funil"}. O desvio é contra a meta, não contra o período anterior.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.horizons.map((item) => (
                  <article key={item.kind} className="rounded-xl border p-3" style={{ borderColor: "var(--vx-border)" }}>
                    <div className="flex items-center gap-3">
                      <GoalRing value={item.ring} />
                      <div>
                        <p className="text-sm font-semibold">{item.label}</p>
                        <p className="text-xs vx-muted">
                          {item.fromYmd} a {item.toYmdInclusive}
                        </p>
                        <p className="text-2xl font-bold">
                          {item.fulfillment == null ? "—" : `${Math.round(item.fulfillment * 100)}%`}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs vx-muted">
                      Realizado {item.realized.toLocaleString("pt-BR")} · Meta {item.target == null ? "não configurada" : item.target.toLocaleString("pt-BR")}
                      {item.deviation == null ? "" : ` · desvio ${(item.deviation * 100).toFixed(1)}%`}
                    </p>
                  </article>
                ))}
              </div>
              <form className="mt-4 grid gap-2 sm:grid-cols-[1fr_8rem_auto]" onSubmit={saveGoal}>
                <Field label="Configurar meta">
                  <select className="vx-input" value={goalKind} onChange={(event) => setGoalKind(event.target.value)}>
                    {data.horizons.map((item) => (
                      <option key={item.kind} value={item.kind}>
                        {item.label}
                      </option>
                    ))}
                    <option value="strategic">Meta estratégica de base</option>
                    <option value="base_stock">Meta de tamanho da base (gráfico)</option>
                  </select>
                </Field>
                <Field label="Valor">
                  <input className="vx-input" inputMode="numeric" value={goalTarget} onChange={(event) => setGoalTarget(event.target.value)} required />
                </Field>
                <div className="flex items-end">
                  <Button type="submit">Salvar meta</Button>
                </div>
                {goalError ? <p className="sm:col-span-3 text-sm text-red-300">{goalError}</p> : null}
              </form>
            </section>

            <section className="vx-card p-4">
              <h2 className="font-bold">Cancelamentos</h2>
              {data.cancellations.available ? (
                <>
                  <p className="mt-2 text-3xl font-bold">{data.cancellations.quantity?.toLocaleString("pt-BR")}</p>
                  <p className="text-sm vx-muted" title="Quantidade: clientes únicos cancelados no período. Taxa: coorte da base convertida no início do período.">
                    Taxa de perda da base inicial: {pct(data.cancellations.rate)}
                    {data.cancellations.rateDeltaPoints == null
                      ? ""
                      : ` (${data.cancellations.rateDeltaPoints >= 0 ? "+" : ""}${data.cancellations.rateDeltaPoints.toFixed(1)} p.p.)`}
                  </p>
                  <p className="text-xs vx-muted">
                    Quantidade {formatChangeLabel(data.cancellations.quantityChange)} — aumento é desfavorável.
                  </p>
                  <div className="mt-4 h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.cancellations.series}>
                        <CartesianGrid stroke="var(--vx-border)" />
                        <XAxis dataKey="label" stroke="var(--vx-muted)" />
                        <YAxis stroke="var(--vx-muted)" allowDecimals={false} />
                        <Tooltip />
                        <Line
                          type="monotone"
                          dataKey="quantity"
                          name="Cancelamentos"
                          stroke="#D96B70"
                          strokeDasharray="4 3"
                          dot
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm vx-muted">{data.cancellations.reason}</p>
              )}
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="vx-card p-4">
              <h2 className="font-bold">Evolução da Base de Clientes</h2>
              <p className="text-xs vx-muted">
                {data.baseEvolution.realizedMetric}. {data.baseEvolution.targetMetric}.
              </p>
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.baseEvolution.months}>
                    <CartesianGrid stroke="var(--vx-border)" />
                    <XAxis dataKey="label" stroke="var(--vx-muted)" />
                    <YAxis stroke="var(--vx-muted)" allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="realized" name="Realizado" stroke="#D4AF37" strokeWidth={2} dot />
                    <Line type="monotone" dataKey="target" name="Meta" stroke="#8FA4B8" strokeDasharray="6 4" dot connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="vx-card p-4">
              <h2 className="font-bold">Mix de Planos</h2>
              {data.planMix.available ? (
                <>
                  <p className="text-xs vx-muted">Unidade: {data.planMix.unit}. Total central: {data.planMix.total}.</p>
                  <div className="mt-2 h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={data.planMix.slices} dataKey="count" nameKey="name" innerRadius={48} outerRadius={72}>
                          {data.planMix.slices.map((slice, index) => (
                            <Cell key={slice.name} fill={MIX_COLORS[index % MIX_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="space-y-1 text-sm">
                    {data.planMix.slices.map((slice, index) => (
                      <li key={slice.name} className="flex justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: MIX_COLORS[index % MIX_COLORS.length] }} />
                          {slice.name}
                        </span>
                        <span>
                          {slice.count} · {(slice.share * 100).toFixed(1)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-3 text-sm vx-muted">{data.planMix.reason}</p>
              )}
            </section>
          </div>

          <section className="vx-card p-4">
            <h2 className="font-bold">Insights Comerciais</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {data.insights.map((item) => (
                <li key={item.id}>{item.text}</li>
              ))}
            </ul>
            {data.strategic ? (
              <p className="mt-4 text-sm">
                {data.strategic.message}
                {data.strategic.onTrack ? " Seguimos no caminho certo: a meta estratégica de base foi atingida." : ""}
              </p>
            ) : (
              <p className="mt-4 text-sm vx-muted">Configure uma meta estratégica de base para acompanhar o objetivo acumulado. LTV não é calculado neste painel.</p>
            )}
            <p className="mt-3 text-xs vx-muted">{data.coverage.conversionSource} {data.coverage.paymentNote} {data.coverage.cancellations}</p>
          </section>
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({ title, hint, value, change }: { title: string; hint: string; value: string; change?: string }) {
  return (
    <article className="vx-card p-4" title={hint}>
      <p className="text-xs font-semibold uppercase vx-muted">{title}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {change ? <p className="mt-1 text-xs vx-muted">{change}</p> : null}
    </article>
  );
}
