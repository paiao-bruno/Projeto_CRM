"use client";

import Link from "next/link";
import { PageHeader, ErrorAlert, formatCents, statusLabels, useResource } from "@/components/vx";

type Overview = {
  generatedAt: string;
  timezone?: string;
  window?: { from: string; to: string };
  conversations: {
    queue: number; inProgress: number; closedToday: number; messagesToday: number;
    openedInWindow?: number; closedInWindow?: number; avgFirstResponseSeconds?: number | null;
    firstResponseSampleSize?: number; hasData: boolean;
  };
  customers: { total: number; byStatus: Record<string, number>; hasData: boolean };
  contracts: { byStatus: Record<string, number>; hasData: boolean };
  invoices: { byStatus: Record<string, { count: number; amountCents: number }>; overdueOpen: { count: number; amountCents: number }; hasData: boolean };
  deals: { byStatus: Record<string, number>; hasData: boolean };
  aiAgents: { byStatus: Record<string, number>; hasData: boolean };
  team: { online: number; away: number; offline: number; hasData: boolean };
  birthdays?: { today: { id: string; name: string }[]; thisMonth: { id: string; name: string }[]; hasData: boolean };
};

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="vx-card p-4">
      <p className="text-xs font-semibold uppercase vx-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint ? <p className="mt-1 text-xs vx-muted">{hint}</p> : null}
    </div>
  );
}

function Block({ title, hasData, emptyText, href, children }: { title: string; hasData: boolean; emptyText: string; href: string; children: React.ReactNode }) {
  return (
    <section className="vx-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold">{title}</h2>
        <Link className="text-sm underline vx-muted" href={href}>Abrir</Link>
      </div>
      {hasData ? children : <p className="text-sm vx-muted">{emptyText}</p>}
    </section>
  );
}

const sumValues = (record: Record<string, number>) => Object.values(record).reduce((a, b) => a + b, 0);

export default function DashboardPage() {
  const { data, error, loading } = useResource<Overview>("/dashboard");

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Indicadores calculados dos dados locais da sua organização" />
      <ErrorAlert message={error ? `Falha ao carregar os indicadores: ${error}` : null} />
      {loading ? <p className="vx-empty">Carregando...</p> : null}
      {data ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Fila de atendimento" value={data.conversations.queue} hint="Conversas sem responsável" />
            <Metric label="Em atendimento" value={data.conversations.inProgress} />
            <Metric label="Encerradas hoje" value={data.conversations.closedToday} />
            <Metric label="Mensagens hoje" value={data.conversations.messagesToday} />
            <Metric
              label="1ª resposta (período)"
              value={data.conversations.avgFirstResponseSeconds == null ? "Sem amostra" : `${Math.round((data.conversations.avgFirstResponseSeconds ?? 0) / 60)} min`}
              hint={data.conversations.firstResponseSampleSize ? `${data.conversations.firstResponseSampleSize} atendimento(s)` : "Não é zero de desempenho"}
            />
            <Metric label="Abertos no período" value={data.conversations.openedInWindow ?? "—"} />
          </div>
          {data.birthdays?.hasData ? (
            <p className="text-sm vx-muted">
              Aniversariantes hoje: {data.birthdays.today.length ? data.birthdays.today.map((p) => p.name).join(", ") : "nenhum"}
              {" · "}no mês: {data.birthdays.thisMonth.length}
            </p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <Block title="Clientes" hasData={data.customers.hasData} emptyText="Sem dados: nenhum cliente cadastrado ainda." href="/customers">
              <p className="text-3xl font-bold">{data.customers.total}</p>
              <ul className="mt-2 text-sm vx-muted">{Object.entries(data.customers.byStatus).map(([k, v]) => <li key={k}>{statusLabels[k] ?? k}: {v}</li>)}</ul>
            </Block>
            <Block title="Faturas" hasData={data.invoices.hasData} emptyText="Sem dados: nenhuma fatura cadastrada ainda." href="/invoices">
              <p className="text-sm">Vencidas em aberto: <strong>{data.invoices.overdueOpen.count}</strong> ({formatCents(data.invoices.overdueOpen.amountCents)})</p>
              <ul className="mt-2 text-sm vx-muted">{Object.entries(data.invoices.byStatus).map(([k, v]) => <li key={k}>{k}: {v.count} · {formatCents(v.amountCents)}</li>)}</ul>
            </Block>
            <Block title="Contratos" hasData={data.contracts.hasData} emptyText="Sem dados: nenhum contrato cadastrado ainda." href="/contracts">
              <p className="text-3xl font-bold">{sumValues(data.contracts.byStatus)}</p>
              <ul className="mt-2 text-sm vx-muted">{Object.entries(data.contracts.byStatus).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
            </Block>
            <Block title="Funil de vendas" hasData={data.deals.hasData} emptyText="Sem dados: nenhuma negociação no funil." href="/sales-funnel">
              <ul className="text-sm vx-muted">{Object.entries(data.deals.byStatus).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
            </Block>
            <Block title="Agentes" hasData={data.aiAgents.hasData} emptyText="Sem dados: nenhum agente configurado." href="/ai-agents">
              <ul className="text-sm vx-muted">{Object.entries(data.aiAgents.byStatus).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
            </Block>
            <Block title="Equipe" hasData={data.team.hasData} emptyText="Sem dados: nenhum atendente com permissão de responder." href="/team">
              <p className="text-sm">Online: <strong>{data.team.online}</strong> · Ausentes: <strong>{data.team.away}</strong> · Offline: <strong>{data.team.offline}</strong></p>
            </Block>
          </div>
          <p className="text-xs vx-muted">Atualizado em {new Date(data.generatedAt).toLocaleString("pt-BR")} · fonte: banco local</p>
        </div>
      ) : null}
    </div>
  );
}
