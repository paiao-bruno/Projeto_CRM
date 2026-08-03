"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  BookOpen,
  Bot,
  Brain,
  CheckCircle2,
  Database,
  FileWarning,
  History,
  MessageSquare,
  Receipt,
  RefreshCcw,
  Sparkles,
  Timer,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { isWebOnlyMode } from "@/lib/runtime-config";
import { WebOnlyApiBanner } from "@/components/legacy-api-unavailable";
import {
  createWebOnlyDashboardShell,
  formatWebOnlyMetric,
} from "@/lib/web-only-empty-states";
import { DashboardOverview } from "@/lib/types";

const cardIcons = {
  messagesProcessed: MessageSquare,
  activeConversations: Activity,
  onlineAgents: Bot,
  responseRate: TrendingUp,
  averageResponseTime: Timer,
  conversions: CheckCircle2,
  activeContracts: Receipt,
  overdueInvoices: FileWarning,
};

const cardLabels = {
  messagesProcessed: "Mensagens processadas",
  activeConversations: "Conversas ativas",
  onlineAgents: "Agentes online",
  responseRate: "Taxa de resposta",
  averageResponseTime: "Tempo medio de resposta",
  conversions: "Conversoes",
  activeContracts: "Contratos ativos",
  overdueInvoices: "Faturas vencidas",
};

function formatDuration(durationMs: number | null | undefined) {
  if (durationMs == null) return "—";
  if (durationMs < 1000) return `${durationMs} ms`;
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function syncStatusVariant(status: string) {
  if (status === "COMPLETED") return "green";
  if (status === "FAILED") return "red";
  if (status === "PARTIAL" || status === "RUNNING") return "amber";
  if (status === "SKIPPED") return "slate";
  return "blue";
}

function healthStatusVariant(status: "healthy" | "warning" | "critical" | "unknown") {
  if (status === "healthy") return "green";
  if (status === "warning") return "amber";
  if (status === "critical") return "red";
  return "slate";
}

function connectionStatusVariant(status: string) {
  if (status === "online" || status === "syncing") return "green";
  if (status === "error") return "red";
  return "amber";
}

export default function DashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState("");
  const webOnly = isWebOnlyMode();

  useEffect(() => {
    if (!token || webOnly) return;
    api
      .get<DashboardOverview>("/dashboard", token)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar."));
  }, [token, webOnly]);

  const effectiveData: DashboardOverview | null = webOnly
    ? createWebOnlyDashboardShell()
    : data;

  if (!webOnly && error) {
    return <div className="rounded-2xl bg-red-500/10 p-4 text-red-200">{error}</div>;
  }

  if (!effectiveData) {
    return <div className="text-slate-400">Carregando dashboard...</div>;
  }

  const dataView = effectiveData;
  const channelTotal = dataView.channelDistribution.reduce(
    (total, item) => total + item.value,
    0,
  );
  const memory = dataView.agentMemory;
  const sgpSync = dataView.sgpSync;

  return (
    <div className="space-y-6">
      <WebOnlyApiBanner />
      <div>
        <h1 className="text-3xl font-semibold text-white">Dashboard</h1>
        <p className="mt-1 text-slate-400">
          Visao operacional em tempo real do atendimento ISP.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(dataView.cards).map(([key, value]) => {
          const Icon = cardIcons[key as keyof typeof cardIcons];
          const label = cardLabels[key as keyof typeof cardLabels];
          const display = webOnly
            ? formatWebOnlyMetric(value, true)
            : key === "responseRate"
              ? `${value}%`
              : value;
          return (
            <Card key={key}>
              <CardContent className="flex items-center justify-between pt-5">
                <div>
                  <p className="text-sm text-slate-400">{label}</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{display}</p>
                </div>
                <span className="rounded-2xl bg-emerald-400/10 p-3 text-emerald-300">
                  <Icon size={24} />
                </span>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="space-y-5">
        <Card>
          <CardHeader>
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div className="flex items-center gap-3">
                <span className="rounded-2xl bg-sky-400/10 p-3 text-sky-300">
                  <RefreshCcw size={24} className={sgpSync.runningSync ? "animate-spin" : ""} />
                </span>
                <div>
                  <CardTitle className="text-2xl">Sincronização SGP</CardTitle>
                  <p className="text-sm text-slate-400">
                    Monitoramento administrativo da integração e histórico resumido.
                  </p>
                </div>
              </div>
              {sgpSync.runningSync ? (
                <Badge variant="amber">Sincronização em andamento</Badge>
              ) : sgpSync.lastSync ? (
                <Badge variant={syncStatusVariant(sgpSync.lastSync.status)}>
                  Última: {sgpSync.lastSync.status}
                </Badge>
              ) : (
                <Badge variant="slate">Sem execuções</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                [
                  "Última sincronização",
                  sgpSync.lastSync
                    ? new Date(sgpSync.lastSync.finishedAt ?? sgpSync.lastSync.startedAt).toLocaleString("pt-BR")
                    : "—",
                ],
                ["Duração", formatDuration(sgpSync.lastSync?.durationMs)],
                ["Registros processados", webOnly ? "—" : sgpSync.recordCount],
                ["Erros", webOnly ? "—" : sgpSync.errorsCount],
              ].map(([label, value]) => (
                <div
                  className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"
                  key={label as string}
                >
                  <p className="text-sm text-slate-400">{label as string}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{value as string | number}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                ["Tempo médio", formatDuration(sgpSync.averageDurationMs)],
                [
                  "Início da última sync",
                  sgpSync.lastSync
                    ? new Date(sgpSync.lastSync.startedAt).toLocaleString("pt-BR")
                    : "—",
                ],
                ["Responsável", sgpSync.lastSync?.triggeredBy ?? "Sistema"],
                [
                  "Modo / origem",
                  sgpSync.lastSync
                    ? `${sgpSync.lastSync.syncMode ?? "—"} · ${sgpSync.lastSync.trigger ?? "—"}`
                    : "—",
                ],
              ].map(([label, value]) => (
                <div
                  className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"
                  key={label as string}
                >
                  <p className="text-sm text-slate-400">{label as string}</p>
                  <p className="mt-2 text-lg font-semibold text-white">{value as string}</p>
                </div>
              ))}
            </div>

            {sgpSync.runningSync ? (
              <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
                Sync em andamento desde{" "}
                {new Date(sgpSync.runningSync.startedAt).toLocaleString("pt-BR")}
                {sgpSync.runningSync.triggeredBy
                  ? ` · iniciada por ${sgpSync.runningSync.triggeredBy}`
                  : ""}
                {" · "}
                {sgpSync.runningSync.recordCount} registros processados até o momento
              </div>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <History className="text-sky-300" size={18} />
                  <p className="font-semibold text-white">Histórico resumido</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-slate-300">
                    <thead className="text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Início</th>
                        <th className="px-3 py-2">Duração</th>
                        <th className="px-3 py-2">Registros</th>
                        <th className="px-3 py-2">Erros</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sgpSync.recentHistory.length === 0 ? (
                        <tr>
                          <td className="px-3 py-4 text-slate-500" colSpan={5}>
                            Nenhuma sincronização registrada.
                          </td>
                        </tr>
                      ) : (
                        sgpSync.recentHistory.map((item) => (
                          <tr className="border-t border-slate-800" key={item.id}>
                            <td className="px-3 py-3">
                              {new Date(item.startedAt).toLocaleString("pt-BR")}
                            </td>
                            <td className="px-3 py-3">{formatDuration(item.durationMs)}</td>
                            <td className="px-3 py-3">{item.recordCount}</td>
                            <td className="px-3 py-3">{item.errorsCount}</td>
                            <td className="px-3 py-3">
                              <Badge variant={syncStatusVariant(item.status)}>{item.status}</Badge>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <Activity className="text-emerald-300" size={18} />
                  <p className="font-semibold text-white">Indicadores de saúde</p>
                </div>
                <div className="space-y-3">
                  {sgpSync.health.map((item) => (
                    <div
                      className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3"
                      key={item.label}
                    >
                      <div>
                        <p className="text-sm font-medium text-white">{item.label}</p>
                        {item.detail ? (
                          <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
                        ) : null}
                      </div>
                      <Badge variant={healthStatusVariant(item.status)}>{item.status}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-5">
        <Card>
          <CardHeader>
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div className="flex items-center gap-3">
                <span className="rounded-2xl bg-violet-400/10 p-3 text-violet-300">
                  <Brain size={24} />
                </span>
                <div>
                  <CardTitle className="text-2xl">Agent Memory</CardTitle>
                  <p className="text-sm text-slate-400">Knowledge and learning</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  ["Total", webOnly ? "—" : memory.summary.totalAgents, Bot],
                  ["Active", webOnly ? "—" : memory.summary.activeAgents, CheckCircle2],
                  ["Average", webOnly ? "—" : `${memory.summary.averageLearning}%`, TrendingUp],
                  ["Memories", webOnly ? "—" : memory.summary.totalMemoriesRegistered, Database],
                ].map(([label, value, Icon]) => {
                  const MetricIcon = Icon as typeof Bot;
                  return (
                    <div
                      className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3"
                      key={label as string}
                    >
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <MetricIcon size={14} />
                        {label as string}
                      </div>
                      <p className="mt-1 text-xl font-semibold text-white">{value as string}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                ["Hoje", webOnly ? "—" : memory.summary.acquiredToday],
                ["Semana", webOnly ? "—" : memory.summary.acquiredThisWeek],
                ["Mês", webOnly ? "—" : memory.summary.acquiredThisMonth],
                ["Crescimento", webOnly ? "—" : `${memory.summary.growthRate}%`],
              ].map(([label, value]) => (
                <div
                  className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"
                  key={label as string}
                >
                  <p className="text-sm text-slate-400">Conhecimentos adquiridos {label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{value as string}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {memory.agents.map((agent) => (
                <div
                  className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"
                  key={agent.id}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <span
                        className="rounded-2xl p-2"
                        style={{
                          backgroundColor: `${agent.levelColor}1A`,
                          color: agent.levelColor,
                        }}
                      >
                        <Brain size={20} />
                      </span>
                      <div>
                        <p className="font-semibold text-white">{agent.name}</p>
                        <p className="text-xs text-slate-500">{agent.function}</p>
                      </div>
                    </div>
                    <p className="text-3xl font-semibold text-slate-200">
                      {agent.learningPercentage}%
                    </p>
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="text-slate-400">Still needs to learn more</span>
                      <Badge
                        className="border"
                        style={{
                          borderColor: `${agent.levelColor}55`,
                          backgroundColor: `${agent.levelColor}1A`,
                          color: agent.levelColor,
                        }}
                      >
                        {agent.levelLabel}
                      </Badge>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${agent.learningPercentage}%`,
                          backgroundColor: agent.levelColor,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex justify-between text-xs text-slate-500">
                      <span>
                        {agent.learnedMemories} / {agent.totalMemories} memórias
                      </span>
                      <span>{agent.remainingMemories} restantes</span>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-2">
                      <p className="text-slate-500">Hoje</p>
                      <p className="font-semibold text-white">{agent.acquiredToday}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-2">
                      <p className="text-slate-500">Semana</p>
                      <p className="font-semibold text-white">{agent.acquiredThisWeek}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-2">
                      <p className="text-slate-500">Growth</p>
                      <p className="font-semibold text-white">{agent.growthRate}%</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    Última atualização: {new Date(agent.lastUpdate).toLocaleString("pt-BR")}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
              <div className="h-80 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <TrendingUp className="text-emerald-300" size={18} />
                  <p className="font-semibold text-white">Learning growth</p>
                </div>
                <ResponsiveContainer height="85%" width="100%">
                  <AreaChart data={memory.chart}>
                    <defs>
                      <linearGradient id="dailyGrowth" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="weeklyGrowth" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="#34d399" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="#64748b" />
                    <YAxis allowDecimals={false} stroke="#64748b" />
                    <Tooltip
                      contentStyle={{
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: 12,
                      }}
                    />
                    <Area
                      dataKey="dailyGrowth"
                      fill="url(#dailyGrowth)"
                      name="Crescimento diário"
                      stroke="#38bdf8"
                    />
                    <Area
                      dataKey="weeklyGrowth"
                      fill="url(#weeklyGrowth)"
                      name="Crescimento semanal"
                      stroke="#34d399"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <BookOpen className="text-violet-300" size={18} />
                  <p className="font-semibold text-white">Knowledge Stages</p>
                </div>
                <div className="space-y-3">
                  {memory.stages.map((stage) => (
                    <div
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 p-3"
                      key={stage.level}
                    >
                      <div className="flex items-center gap-3">
                        <Sparkles size={16} style={{ color: stage.color }} />
                        <div>
                          <p className="text-sm font-semibold text-white">{stage.label}</p>
                          <p className="text-xs text-slate-500">{stage.range}</p>
                        </div>
                      </div>
                      <span
                        className="h-2 w-16 rounded-full"
                        style={{ backgroundColor: stage.color }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Mensagens por dia</CardTitle>
            <p className="text-sm text-slate-400">Entrada e saida nos ultimos 7 dias.</p>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer height="100%" width="100%">
              <AreaChart data={dataView.chart}>
                <defs>
                  <linearGradient id="inbound" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="outbound" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip
                  contentStyle={{
                    background: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: 12,
                  }}
                />
                <Area dataKey="inbound" fill="url(#inbound)" stroke="#38bdf8" />
                <Area dataKey="outbound" fill="url(#outbound)" stroke="#22c55e" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conexoes</CardTitle>
            <p className="text-sm text-slate-400">Status dos servicos principais.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {dataView.health.map((item) => (
              <div
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 p-3"
                key={item.label}
              >
                <span className="text-sm text-slate-200">{item.label}</span>
                <Badge variant={connectionStatusVariant(item.status)}>
                  {item.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
          <CardHeader>
            <CardTitle className="text-2xl text-slate-950">Channel Distribution</CardTitle>
            <p className="text-sm text-slate-500">Share by channel</p>
          </CardHeader>
          <CardContent>
            <div className="grid items-center gap-8 md:grid-cols-[260px_1fr]">
              <div className="relative h-64">
                <ResponsiveContainer height="100%" width="100%">
                  <PieChart>
                    <Pie
                      cx="50%"
                      cy="50%"
                      data={dataView.channelDistribution}
                      dataKey="value"
                      innerRadius={64}
                      outerRadius={104}
                      paddingAngle={2}
                      stroke="#ffffff"
                      strokeWidth={3}
                    >
                      {dataView.channelDistribution.map((entry) => (
                        <Cell fill={entry.color} key={entry.name} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: 12,
                        color: "#0f172a",
                      }}
                      formatter={(value, name) => [
                        `${Number(value ?? 0)} mensagens`,
                        name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <p className="text-3xl font-semibold text-slate-950">
                      {webOnly || channelTotal === 0 ? "—" : channelTotal}
                    </p>
                    <p className="text-xs text-slate-500">Total</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {dataView.channelDistribution.map((item) => (
                  <div className="flex items-center justify-between gap-4" key={item.name}>
                    <div className="flex items-center gap-3">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="font-medium text-slate-700">{item.name}</span>
                    </div>
                    <div className="flex min-w-28 items-center justify-between gap-4">
                      <span className="text-sm text-slate-500">{item.value}</span>
                      <span
                        className="rounded-full px-2 py-1 text-xs font-semibold"
                        style={{
                          backgroundColor: `${item.color}1A`,
                          color: item.color,
                        }}
                      >
                        {item.percentage}%
                      </span>
                    </div>
                  </div>
                ))}
                <div className="border-t border-slate-200 pt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Total</span>
                    <span className="font-semibold text-slate-950">
                      {webOnly ? "—" : channelTotal}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
          <CardHeader>
            <CardTitle className="text-2xl text-slate-950">Agent Performance</CardTitle>
            <p className="text-sm text-slate-500">Total messages processed</p>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart
                data={dataView.agentPerformance}
                margin={{ bottom: 8, left: -20, right: 8, top: 16 }}
              >
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="name"
                  tick={{ fill: "#64748b", fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    color: "#0f172a",
                  }}
                  formatter={(value) => [
                    `${Number(value ?? 0)} mensagens`,
                    "Processadas",
                  ]}
                />
                <Bar dataKey="messagesProcessed" radius={[10, 10, 0, 0]}>
                  {dataView.agentPerformance.map((entry) => (
                    <Cell fill={entry.color} key={entry.name} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
