"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorAlert, Field, PageHeader, useResource } from "@/components/vx";
import { api } from "@/lib/api";
import { formatChangeLabel } from "@/lib/dashboard-commercial-metrics";
import { formatChurnPercent } from "@/lib/churn-metrics";
import {
  churnPollIntervalMs,
  isChurnRealtimeEvent,
  preferFresherPayload,
  shouldPollChurnLifecycle,
  type SgpChurnLifecycle,
} from "@/lib/sgp-churn-lifecycle";
import { connectRealtime } from "@/lib/realtime-client";
import { useAuth } from "@/components/auth-provider";

type ChurnResponse = {
  generatedAt: string;
  timeZone: string;
  period: { fromYmd: string; toYmdInclusive: string; preset: string; comparisonLabel: string };
  source: {
    name: string;
    configured: boolean;
    tokenConfigured: boolean;
    apiHost: string | null;
    lastSyncAt: string | null;
    coverage: string;
    snapshotStatus: string;
    lifecycle: string;
    stale?: boolean;
    lastError?: string | null;
    lastSuccessAt?: string | null;
    lastAttemptAt?: string | null;
    nextAttemptAt?: string | null;
    refreshMs?: number;
  };
  cards: Array<{
    kind: string;
    label: string;
    fromYmd: string;
    toYmdInclusive: string;
    targetLabel: string;
    realized: number | null;
    status: string;
    cancellations: number | null;
    partialMonth?: boolean;
    coverage: string;
    formula: string;
  }>;
  evolution: Array<{ label: string; churn: number | null; meta: number | null; lost: number | null }>;
  reasons: { total: number | null; unit: string; slices: Array<{ name: string; count: number; share: number }> };
  indicators: {
    activeCustomers: { value: number | null; label: string; at: string | null };
    cancellations: { value: number | null; change: { kind: "pct" | "none"; value: number | null } };
    churn: { value: number | null };
  };
  insights: Array<{ id: string; text: string; kind: "fact" | "recommendation" }>;
  dictionary: Record<string, string>;
};

const MIX = ["#D4AF37", "#243B53", "#3D7A5A", "#4F7A9A", "#8FA4B8", "#C4BFA8"];

function statusLabel(status: string) {
  if (status === "within") return "Dentro";
  if (status === "above") return "Acima";
  if (status === "no_goal") return "Sem meta";
  return "Indisponível";
}

function lifecycleCopy(lifecycle: string) {
  if (lifecycle === "ready") return "Dados atualizados.";
  if (lifecycle === "stale") return "Dados anteriores disponíveis, porém desatualizados. A sincronização automática já foi solicitada.";
  if (lifecycle === "syncing") return "Sincronizando a fotografia de cancelamentos.";
  if (lifecycle === "validating") return "Conectando e validando a leitura SGP.";
  if (lifecycle === "auth_denied") {
    return "Integração indisponível: o SGP recusou a autenticação. Quantidades não são zero. Um administrador deve gravar App e Token reais em Integrações (não o e-mail do CRM).";
  }
  if (lifecycle === "decrypt_failed") {
    return "Falha ao decifrar as credenciais SGP neste processo. Ainda não foi possível avaliar o histórico. Isso não prova recusa do SGP.";
  }
  if (lifecycle === "needs_config") return "Configuração necessária: um administrador provisiona App e Token uma vez em Integrações.";
  if (lifecycle === "unavailable") return "Integração indisponível no momento. A última fotografia válida, se existir, permanece visível.";
  return "Validando conexão.";
}

function formatCount(value: number | null | undefined) {
  return value == null ? "Indisponível" : value.toLocaleString("pt-BR");
}

export function CancellationsDashboard() {
  const { token, user } = useAuth();
  const canManage = Boolean(user?.permissions?.includes("customers.manage"));
  const [preset, setPreset] = useState("last_12_closed_months");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [goalKind, setGoalKind] = useState("annual");
  const [goalPercent, setGoalPercent] = useState("");
  const [formError, setFormError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (preset === "custom" && from && to) {
      params.set("from", from);
      params.set("to", to);
    } else params.set("preset", preset);
    return `/dashboard/churn?${params}`;
  }, [preset, from, to]);
  const resource = useResource<ChurnResponse>(query);
  const { error, loading } = resource;
  const [data, setData] = useState<ChurnResponse | null>(null);

  useEffect(() => {
    if (resource.data) setData((current) => preferFresherPayload(current, resource.data as ChurnResponse));
  }, [resource.data]);

  useEffect(() => {
    if (!token) return;
    const stop = connectRealtime({
      token,
      onChange: (change) => {
        if (isChurnRealtimeEvent(change.type)) void resource.reload();
      },
      onResync: () => {
        void resource.reload();
      },
      onState: () => undefined,
    });
    return stop;
  }, [token, resource.reload]);

  useEffect(() => {
    const lifecycle = data?.source.lifecycle as SgpChurnLifecycle | undefined;
    if (!lifecycle || !shouldPollChurnLifecycle(lifecycle)) return;
    const timer = setInterval(() => {
      void resource.reload();
    }, churnPollIntervalMs(lifecycle));
    return () => clearInterval(timer);
  }, [data?.source.lifecycle, resource.reload]);

  async function saveGoal(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setFormError("");
    try {
      await api.patch("/dashboard/churn/goals", { kind: goalKind, targetPercent: Number(goalPercent.replace(",", ".")) }, token);
      setGoalPercent("");
      await resource.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao salvar a meta.");
    }
  }

  async function sync() {
    if (!token) return;
    setSyncing(true);
    setFormError("");
    try {
      await api.post("/dashboard/churn/sync", {}, token);
      await resource.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao atualizar o SGP.");
      await resource.reload();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Gestão de Cancelamentos"
        subtitle="Analise, entenda e tome decisões estratégicas"
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Ban className="h-5 w-5" aria-hidden="true" style={{ color: "var(--vx-primary)" }} />
            <select className="vx-input" value={preset} onChange={(event) => setPreset(event.target.value)} aria-label="Período">
              <option value="last_12_closed_months">Últimos 12 meses completos</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="15d">Últimos 15 dias</option>
              <option value="monthly">Último mês</option>
              <option value="quarterly">Últimos 3 meses</option>
              <option value="semiannual">Últimos 6 meses</option>
              <option value="annual">Últimos 12 meses (até hoje)</option>
              <option value="custom">Personalizado</option>
            </select>
            {preset === "custom" ? (
              <>
                <input className="vx-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Data inicial" />
                <input className="vx-input" type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="Data final" />
              </>
            ) : null}
            <Button variant="secondary" onClick={() => void sync()} disabled={syncing}>
              {syncing ? "Atualizando..." : "Atualizar"}
            </Button>
          </div>
        }
      />
      <ErrorAlert message={error || formError || null} />
      {loading && !data ? <p className="vx-empty">Carregando gestão de cancelamentos...</p> : null}
      {data ? (
        <>
          <p className="text-sm">{lifecycleCopy(data.source.lifecycle)}</p>
          <p className="text-xs vx-muted">
            {data.period.fromYmd} a {data.period.toYmdInclusive} ({data.timeZone})
            {" · "}
            {data.source.lastSyncAt
              ? `última sincronização ${new Date(data.source.lastSyncAt).toLocaleString("pt-BR", { timeZone: data.timeZone })}`
              : "ainda sem fotografia completa"}
            {data.source.stale ? " · desatualizado" : ""}
            {data.source.lastAttemptAt
              ? ` · última tentativa ${new Date(data.source.lastAttemptAt).toLocaleString("pt-BR", { timeZone: data.timeZone })}`
              : ""}
            {data.source.nextAttemptAt
              ? ` · próxima atualização automática ${new Date(data.source.nextAttemptAt).toLocaleString("pt-BR", { timeZone: data.timeZone })}`
              : ""}
            {" · "}
            {data.period.comparisonLabel}
          </p>
          <p className="text-xs vx-muted">{data.source.coverage}</p>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.cards.map((card) => (
              <article
                key={card.kind}
                className="vx-card p-4"
                title={`${card.formula} ${card.coverage}`}
                style={card.kind === "annual" ? { borderColor: "var(--vx-primary)" } : undefined}
              >
                <p className="text-xs font-semibold uppercase vx-muted">{card.label}</p>
                <p className="text-xs vx-muted">
                  {card.fromYmd} a {card.toYmdInclusive}
                  {card.partialMonth ? " · mês parcial" : ""}
                </p>
                <p className="mt-2 text-sm">{card.targetLabel}</p>
                <p className="text-2xl font-bold">{formatChurnPercent(card.realized)}</p>
                <p className="text-sm">{statusLabel(card.status)}</p>
                <hr className="my-2" style={{ borderColor: "var(--vx-border)" }} />
                <p className="text-sm">Cancelamentos: {formatCount(card.cancellations)}</p>
              </article>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="vx-card p-4">
              <h2 className="font-bold">Evolução do Churn</h2>
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.evolution}>
                    <CartesianGrid stroke="var(--vx-border)" />
                    <XAxis dataKey="label" stroke="var(--vx-muted)" />
                    <YAxis stroke="var(--vx-muted)" tickFormatter={(value) => `${(Number(value) * 100).toFixed(1)}%`} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="churn" name="Churn (%)" stroke="#D4AF37" strokeWidth={2} dot connectNulls={false} />
                    <Line type="monotone" dataKey="meta" name="Meta (%)" stroke="#8FA4B8" strokeDasharray="6 4" dot connectNulls={false} />
                    <Area type="monotone" dataKey="churn" stroke="none" fill="#D4AF37" fillOpacity={0.08} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="vx-card p-4">
              <h2 className="font-bold">Motivos de Cancelamento</h2>
              <p className="text-xs vx-muted">
                Total {formatCount(data.reasons.total)} · {data.reasons.unit}
              </p>
              {data.reasons.total ? (
                <>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={data.reasons.slices} dataKey="count" nameKey="name" innerRadius={48} outerRadius={72}>
                          {data.reasons.slices.map((slice, index) => (
                            <Cell key={slice.name} fill={MIX[index % MIX.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="space-y-1 text-sm">
                    {data.reasons.slices.map((slice, index) => (
                      <li key={slice.name} className="flex justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: MIX[index % MIX.length] }} />
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
                <p className="mt-3 text-sm vx-muted">
                  {data.source.lifecycle === "ready" || data.source.lifecycle === "stale"
                    ? "Sem contratos cancelados na fotografia publicada."
                    : "Ainda não foi possível avaliar motivos: não há fotografia completa publicada."}
                </p>
              )}
            </section>
          </div>

          <section className="vx-card overflow-x-auto p-4">
            <h2 className="font-bold">Detalhamento por Período</h2>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left vx-muted">
                  <th className="py-1">Período</th>
                  <th>Meta</th>
                  <th>Realizado</th>
                  <th>Cancelamentos</th>
                  <th>Churn</th>
                </tr>
              </thead>
              <tbody>
                {data.cards.map((card) => (
                  <tr key={card.kind} className="border-t" style={{ borderColor: "var(--vx-border)" }}>
                    <td className="py-2">
                      {card.label}
                      <div className="text-xs vx-muted">
                        {card.fromYmd} a {card.toYmdInclusive}
                      </div>
                    </td>
                    <td>{card.targetLabel}</td>
                    <td>{formatChurnPercent(card.realized)}</td>
                    <td>{formatCount(card.cancellations)}</td>
                    <td>{statusLabel(card.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="vx-card p-4">
              <h2 className="font-bold">Principais Indicadores</h2>
              <p className="mt-2 text-sm">
                Clientes ativos ({data.indicators.activeCustomers.label}): <strong>{formatCount(data.indicators.activeCustomers.value)}</strong>
              </p>
              <p className="text-sm">
                Total de cancelamentos do período: <strong>{formatCount(data.indicators.cancellations.value)}</strong>{" "}
                <span className="vx-muted">{formatChangeLabel(data.indicators.cancellations.change)}</span>
              </p>
              <p className="text-sm">
                {data.period.preset === "last_12_closed_months" || data.period.preset === "annual"
                  ? "Churn de 12 meses"
                  : "Churn do período"}
                : {formatChurnPercent(data.indicators.churn.value)}
              </p>
            </section>
            <section className="vx-card p-4">
              <h2 className="font-bold">Insights e Recomendações</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {data.insights.map((item) => (
                  <li key={item.id}>
                    <span className="vx-muted">{item.kind === "fact" ? "Fato. " : "Recomendação. "}</span>
                    {item.text}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {canManage ? (
          <form className="vx-card grid gap-3 p-4 sm:grid-cols-[1fr_8rem_auto]" onSubmit={saveGoal}>
            <Field label="Meta de churn (%)">
              <select className="vx-input" value={goalKind} onChange={(event) => setGoalKind(event.target.value)}>
                {data.cards.map((card) => (
                  <option key={card.kind} value={card.kind}>
                    {card.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Valor">
              <input className="vx-input" value={goalPercent} onChange={(event) => setGoalPercent(event.target.value)} placeholder="0,00" required />
            </Field>
            <div className="flex items-end">
              <Button type="submit">Salvar meta</Button>
            </div>
          </form>
          ) : null}
          <p className="text-xs vx-muted">{data.dictionary.rate} 0% é uma meta válida. Sem taxa calculável o cartão fica Indisponível, não Dentro.</p>
        </>
      ) : null}
    </div>
  );
}
