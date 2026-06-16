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
import { Activity, Bot, CheckCircle2, MessageSquare, Timer, TrendingUp } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { DashboardOverview } from "@/lib/types";

const cardIcons = {
  messagesProcessed: MessageSquare,
  activeConversations: Activity,
  onlineAgents: Bot,
  responseRate: TrendingUp,
  averageResponseTime: Timer,
  conversions: CheckCircle2,
};

const cardLabels = {
  messagesProcessed: "Mensagens processadas",
  activeConversations: "Conversas ativas",
  onlineAgents: "Agentes online",
  responseRate: "Taxa de resposta",
  averageResponseTime: "Tempo medio de resposta",
  conversions: "Conversoes",
};

export default function DashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    api
      .get<DashboardOverview>("/dashboard", token)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar."));
  }, [token]);

  if (error) {
    return <div className="rounded-2xl bg-red-500/10 p-4 text-red-200">{error}</div>;
  }

  if (!data) {
    return <div className="text-slate-400">Carregando dashboard...</div>;
  }

  const channelTotal = data.channelDistribution.reduce(
    (total, item) => total + item.value,
    0,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Dashboard</h1>
        <p className="mt-1 text-slate-400">
          Visao operacional em tempo real do atendimento ISP.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(data.cards).map(([key, value]) => {
          const Icon = cardIcons[key as keyof typeof cardIcons];
          const label = cardLabels[key as keyof typeof cardLabels];
          const display = key === "responseRate" ? `${value}%` : value;
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

      <section className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Mensagens por dia</CardTitle>
            <p className="text-sm text-slate-400">Entrada e saida nos ultimos 7 dias.</p>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer height="100%" width="100%">
              <AreaChart data={data.chart}>
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
            {data.health.map((item) => (
              <div
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 p-3"
                key={item.label}
              >
                <span className="text-sm text-slate-200">{item.label}</span>
                <Badge variant={item.status === "online" ? "green" : "amber"}>
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
                      data={data.channelDistribution}
                      dataKey="value"
                      innerRadius={64}
                      outerRadius={104}
                      paddingAngle={2}
                      stroke="#ffffff"
                      strokeWidth={3}
                    >
                      {data.channelDistribution.map((entry) => (
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
                      {channelTotal}
                    </p>
                    <p className="text-xs text-slate-500">Total</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {data.channelDistribution.map((item) => (
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
                    <span className="font-semibold text-slate-950">{channelTotal}</span>
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
                data={data.agentPerformance}
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
                  {data.agentPerformance.map((entry) => (
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
