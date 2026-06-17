"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Mail,
  MessageCircle,
  Plug,
  RefreshCcw,
  Send,
  Server,
  Unplug,
  Webhook,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type IntegrationStatus = "online" | "offline" | "error";
type ChannelType = "WhatsApp" | "Telegram" | "Email" | "API Externa" | "Webhook";

type IntegrationItem = {
  id: string;
  name: string;
  type: ChannelType;
  status: IntegrationStatus;
  automationStatus: "AI Active" | "Manual" | "Paused";
  linkedAgent: string;
  apiUrl: string;
  token: string;
  username: string;
  password: string;
  lastSync: string;
  errors: string[];
  history: string[];
};

const channelIcon = {
  WhatsApp: MessageCircle,
  Telegram: Send,
  Email: Mail,
  "API Externa": Server,
  Webhook: Webhook,
};

const initialIntegrations: IntegrationItem[] = [
  {
    id: "sgp",
    name: "SGP",
    type: "API Externa",
    status: "online",
    automationStatus: "AI Active",
    linkedAgent: "Nina Suporte",
    apiUrl: "https://webmais.sgp.net.br",
    token: "1b7139af-6187-402e-bb05-54bb3ed9c344",
    username: "siacbot",
    password: "••••••••",
    lastSync: "Hoje, 13:28",
    errors: [],
    history: ["Sincronizacao concluida", "Agente vinculado", "Credenciais atualizadas"],
  },
  {
    id: "whatsapp",
    name: "WhatsApp Suporte",
    type: "WhatsApp",
    status: "offline",
    automationStatus: "Paused",
    linkedAgent: "Nina Suporte",
    apiUrl: "https://graph.facebook.com/v20.0",
    token: "wa-token-demo",
    username: "+55 11 99999-0001",
    password: "••••••••",
    lastSync: "Ontem, 18:04",
    errors: ["Sessao desconectada pelo provedor"],
    history: ["Falha de ping", "QR Code expirado", "Webhook validado"],
  },
  {
    id: "webhook-billing",
    name: "Billing Webhook",
    type: "Webhook",
    status: "online",
    automationStatus: "Manual",
    linkedAgent: "Leo Vendas",
    apiUrl: "https://api.isp.local/webhooks/billing",
    token: "webhook-secret-demo",
    username: "billing-service",
    password: "••••••••",
    lastSync: "Hoje, 12:10",
    errors: [],
    history: ["Evento invoice.paid recebido", "Assinatura validada"],
  },
];

function MetricCard({
  title,
  value,
  hint,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  hint: string;
  icon: typeof Plug;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between pt-5">
        <div>
          <p className="text-sm text-slate-400">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
          <p className="mt-1 text-xs text-emerald-300">{hint}</p>
        </div>
        <span className="rounded-2xl bg-emerald-400/10 p-3 text-emerald-300">
          <Icon size={22} />
        </span>
      </CardContent>
    </Card>
  );
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState("sgp");
  const [editing, setEditing] = useState<IntegrationItem | null>(null);

  const filtered = useMemo(
    () =>
      integrations.filter((integration) =>
        `${integration.name} ${integration.type} ${integration.linkedAgent}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [integrations, search],
  );

  const active = integrations.filter((item) => item.status === "online").length;
  const inactive = integrations.length - active;
  const activationRate = Math.round((active / integrations.length) * 100);

  function updateStatus(id: string, status: IntegrationStatus) {
    setIntegrations((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              lastSync: "Agora",
              history: [`Status alterado para ${status}`, ...item.history],
              errors: status === "error" ? item.errors : [],
            }
          : item,
      ),
    );
  }

  function saveIntegration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setIntegrations((current) =>
      current.map((item) => (item.id === editing.id ? editing : item)),
    );
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="text-3xl font-semibold text-white">Integrations</h1>
          <p className="mt-1 text-slate-400">
            Connect platforms and tools that expand the ecosystem.
          </p>
        </div>
        <Button onClick={() => setEditing({ ...initialIntegrations[0], id: crypto.randomUUID(), name: "New Integration" })}>
          <Plug size={17} />
          New Integration
        </Button>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Plug} title="Total Integrations" value={integrations.length} hint={`${integrations.length} types`} />
        <MetricCard icon={CheckCircle2} title="Active Integrations" value={active} hint={`${activationRate}% active`} />
        <MetricCard icon={AlertCircle} title="Inactive Integrations" value={inactive} hint="require attention" />
        <MetricCard icon={Activity} title="Activation Rate" value={`${activationRate}%`} hint="connection health" />
      </section>

      <Input
        placeholder="Search Integrations"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <section className="space-y-4">
        {filtered.map((integration) => {
          const Icon = channelIcon[integration.type];
          const expanded = expandedId === integration.id;
          return (
            <Card key={integration.id} className="overflow-hidden">
              <button
                className="flex w-full items-center justify-between gap-4 p-5 text-left"
                onClick={() => setExpandedId(expanded ? "" : integration.id)}
                type="button"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <span className="rounded-2xl bg-sky-400/10 p-3 text-sky-300">
                    <Icon size={22} />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-white">{integration.name}</h2>
                      <Badge variant="blue">{integration.type}</Badge>
                      <Badge variant={integration.status === "online" ? "green" : integration.status === "error" ? "red" : "amber"}>
                        {integration.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">
                      Linked agent: {integration.linkedAgent} · Automation: {integration.automationStatus}
                    </p>
                  </div>
                </div>
                <ChevronDown className={cn("shrink-0 transition", expanded && "rotate-180")} size={18} />
              </button>

              {expanded ? (
                <CardContent className="grid gap-4 border-t border-slate-800 md:grid-cols-2">
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Monitoramento</p>
                      <div className="mt-3 grid gap-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Status</span>
                          <span className="font-semibold text-white">{integration.status}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Última sincronização</span>
                          <span className="font-semibold text-white">{integration.lastSync}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Erros</span>
                          <span className={integration.errors.length ? "font-semibold text-red-300" : "font-semibold text-emerald-300"}>
                            {integration.errors.length || "Nenhum"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {integration.type === "WhatsApp" ? (
                        <>
                          <Button size="sm" onClick={() => updateStatus(integration.id, "online")}>
                            <MessageCircle size={16} />
                            Conectar número
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => updateStatus(integration.id, "online")}>
                            <RefreshCcw size={16} />
                            Reconectar
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => updateStatus(integration.id, "offline")}>
                            <Unplug size={16} />
                            Desconectar
                          </Button>
                        </>
                      ) : null}
                      <Button size="sm" variant="secondary" onClick={() => setEditing(integration)}>
                        Edit
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Histórico de eventos</p>
                    <div className="mt-4 space-y-3">
                      {integration.history.map((event) => (
                        <div className="flex items-center gap-3 text-sm" key={event}>
                          <span className="h-2 w-2 rounded-full bg-emerald-300" />
                          <span className="text-slate-300">{event}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </section>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit integration</DialogTitle>
            <DialogDescription>Update the integration settings</DialogDescription>
          </DialogHeader>
          {editing ? (
            <form className="space-y-5 p-6" onSubmit={saveIntegration}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Nome da integração</Label>
                  <Input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <select
                    className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none"
                    value={editing.status}
                    onChange={(event) => setEditing({ ...editing, status: event.target.value as IntegrationStatus })}
                  >
                    <option value="online">online</option>
                    <option value="offline">offline</option>
                    <option value="error">error</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>URL da API</Label>
                <Input value={editing.apiUrl} onChange={(event) => setEditing({ ...editing, apiUrl: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Token</Label>
                <Input value={editing.token} onChange={(event) => setEditing({ ...editing, token: event.target.value })} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Usuário</Label>
                  <Input value={editing.username} onChange={(event) => setEditing({ ...editing, username: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Senha</Label>
                  <Input value={editing.password} onChange={(event) => setEditing({ ...editing, password: event.target.value })} />
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-800 pt-5">
                <DialogClose asChild>
                  <Button type="button" variant="secondary">Cancelar</Button>
                </DialogClose>
                <Button type="submit">Salvar</Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
