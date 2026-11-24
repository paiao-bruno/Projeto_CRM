"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Megaphone, Plus } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  AD_CHANNELS,
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_STATUS_LABELS,
} from "@/lib/campaigns";
import { cn } from "@/lib/utils";

type TabId = "overview" | "origins" | "channels" | "whatsapp";

type CampaignRow = {
  id: string;
  name: string;
  description?: string | null;
  channel: string;
  status: string;
  archivedAt?: string | null;
  updatedAt: string;
  _count?: { deals: number; recipients: number };
};

type CampaignDetail = CampaignRow & {
  deals: Array<{ id: string; title: string; status: string; stage: { name: string; code: string | null } }>;
};

type Paged<T> = { data: T[]; total: number; page: number; limit: number; totalPages: number };

type SaleOrigin = { id: string; name: string; active: boolean };

type WhatsappOverview = {
  integrationAvailable: boolean;
  reason: string | null;
  period: string;
  lastSyncedAt: string | null;
  messagingLimit: { used: number; cap: number } | null;
  quality: { status: string } | null;
  totals: {
    campaigns: number;
    sent: number;
    delivered: number;
    read: number;
    responded: number;
    failed: number;
    queued: number;
  };
  rates: Record<string, number | null>;
  definitions: Record<string, string>;
  docs: Record<string, string>;
};

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Visão geral" },
  { id: "origins", label: "Origens de venda" },
  { id: "channels", label: "Canais de divulgação" },
  { id: "whatsapp", label: "Campanhas do WhatsApp" },
];

function formatRate(value: number | null) {
  if (value === null || Number.isNaN(value)) return "Indisponível";
  return `${Math.round(value * 1000) / 10}%`;
}

export default function CampaignsPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<TabId>("overview");
  const [search, setSearch] = useState("");
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", channel: "LOCAL" });
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);

  const [origins, setOrigins] = useState<SaleOrigin[]>([]);
  const [originsLoading, setOriginsLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [newOrigin, setNewOrigin] = useState("");
  const [originError, setOriginError] = useState("");
  const [editingOrigin, setEditingOrigin] = useState<{ id: string; name: string } | null>(null);

  const [whatsapp, setWhatsapp] = useState<WhatsappOverview | null>(null);
  const [whatsappPeriod, setWhatsappPeriod] = useState("30d");
  const [whatsappLoading, setWhatsappLoading] = useState(false);

  const loadCampaigns = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20", includeArchived: "true" });
      if (search.trim()) params.set("search", search.trim());
      const result = await api.get<Paged<CampaignRow>>(`/campaigns?${params.toString()}`, token);
      setCampaigns(result.data);
      setTotalPages(result.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as campanhas.");
    } finally {
      setLoading(false);
    }
  }, [token, page, search]);

  const loadOrigins = useCallback(async () => {
    if (!token) return;
    setOriginsLoading(true);
    setOriginError("");
    try {
      const data = await api.get<SaleOrigin[]>(
        `/sale-origins${showInactive ? "?includeInactive=true" : ""}`,
        token,
      );
      setOrigins(data);
    } catch (err) {
      setOriginError(err instanceof Error ? err.message : "Não foi possível carregar origens.");
    } finally {
      setOriginsLoading(false);
    }
  }, [token, showInactive]);

  const loadWhatsapp = useCallback(async () => {
    if (!token) return;
    setWhatsappLoading(true);
    try {
      const data = await api.get<WhatsappOverview>(
        `/campaigns/whatsapp/overview?period=${whatsappPeriod}`,
        token,
      );
      setWhatsapp(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o painel do WhatsApp.");
    } finally {
      setWhatsappLoading(false);
    }
  }, [token, whatsappPeriod]);

  useEffect(() => {
    if (tab === "overview" || tab === "whatsapp") void loadCampaigns();
  }, [tab, loadCampaigns]);

  useEffect(() => {
    if (tab === "origins" || tab === "channels") void loadOrigins();
  }, [tab, loadOrigins]);

  useEffect(() => {
    if (tab === "whatsapp") void loadWhatsapp();
  }, [tab, loadWhatsapp]);

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    if (!token || saving) return;
    setSaving(true);
    setError("");
    try {
      await api.post("/campaigns", draft, token);
      setDraft({ name: "", description: "", channel: "LOCAL" });
      setCreating(false);
      setNotice("Campanha salva como rascunho.");
      await loadCampaigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a campanha.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveCampaign(id: string) {
    if (!token) return;
    try {
      await api.post(`/campaigns/${id}/archive`, {}, token);
      setNotice("Campanha arquivada. Os vínculos do Funil foram preservados.");
      await loadCampaigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível arquivar.");
    }
  }

  async function openDetail(id: string) {
    if (!token) return;
    try {
      const data = await api.get<CampaignDetail>(`/campaigns/${id}`, token);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível abrir a campanha.");
    }
  }

  async function saveCampaignName(campaign: CampaignRow, name: string) {
    if (!token) return;
    try {
      await api.patch(`/campaigns/${campaign.id}`, { name }, token);
      setNotice("Nome atualizado.");
      await loadCampaigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível editar.");
    }
  }

  async function addOrigin(name: string) {
    if (!token || saving) return;
    setSaving(true);
    setOriginError("");
    try {
      await api.post("/sale-origins", { name }, token);
      setNewOrigin("");
      setNotice("Origem cadastrada.");
      await loadOrigins();
    } catch (err) {
      setOriginError(err instanceof Error ? err.message : "Não foi possível cadastrar a origem.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs vx-muted">Início / Campanhas</p>
        <h1 className="mt-1 text-3xl font-semibold text-white">Campanhas</h1>
        <p className="mt-1 text-slate-400">
          Cadastro comercial da organização. Associar uma campanha a uma oportunidade classifica o Funil; não envia mensagens nem altera consentimento.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Seções de Campanhas">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-semibold",
              tab === item.id ? "bg-amber-400/20 text-amber-200" : "text-slate-400 hover:bg-slate-900 hover:text-white",
            )}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {notice ? <p className="text-sm text-emerald-300">{notice}</p> : null}
      {error ? (
        <div className="rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-200">
          <p>{error}</p>
          <Button className="mt-2" variant="secondary" onClick={() => void loadCampaigns()}>
            Tentar novamente
          </Button>
        </div>
      ) : null}

      {tab === "overview" ? (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <Label htmlFor="campaign-search">Localizar campanhas</Label>
              <Input
                id="campaign-search"
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
                placeholder="Nome da campanha"
              />
            </div>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> Nova campanha
            </Button>
          </div>

          {creating ? (
            <Card>
              <CardHeader>
                <CardTitle>Nova campanha local</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={createCampaign}>
                  <div>
                    <Label htmlFor="campaign-name">Nome</Label>
                    <Input
                      id="campaign-name"
                      required
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="campaign-channel">Canal</Label>
                    <select
                      id="campaign-channel"
                      className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm"
                      value={draft.channel}
                      onChange={(event) => setDraft({ ...draft, channel: event.target.value })}
                    >
                      {CAMPAIGN_CHANNELS.map((channel) => (
                        <option key={channel} value={channel}>
                          {CAMPAIGN_CHANNEL_LABELS[channel]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="campaign-description">Descrição</Label>
                    <Textarea
                      id="campaign-description"
                      value={draft.description}
                      onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    Não é necessário número WhatsApp, modelo aprovado ou credencial Meta para cadastrar.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={saving}>
                      {saving ? "Salvando..." : "Salvar rascunho"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {loading ? <p className="text-sm text-slate-400">Carregando campanhas...</p> : null}
          {!loading && campaigns.length === 0 ? (
            <Card>
              <CardContent className="flex min-h-48 flex-col items-center justify-center text-center">
                <Megaphone className="mb-2 text-slate-500" />
                <p className="font-semibold text-white">Nenhuma campanha ainda</p>
                <p className="text-sm text-slate-400">Crie um rascunho local para associá-lo às oportunidades do Funil.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {campaigns.map((campaign) => (
                <article key={campaign.id} className="rounded-2xl border border-slate-800 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-white">{campaign.name}</h2>
                      <p className="text-xs text-slate-400">
                        {CAMPAIGN_CHANNEL_LABELS[campaign.channel as keyof typeof CAMPAIGN_CHANNEL_LABELS] ?? campaign.channel}
                        {" · "}
                        {CAMPAIGN_STATUS_LABELS[campaign.status as keyof typeof CAMPAIGN_STATUS_LABELS] ?? campaign.status}
                        {campaign.archivedAt ? " · Arquivada" : ""}
                        {" · "}
                        {campaign._count?.deals ?? 0} oportunidades vinculadas
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => void openDetail(campaign.id)}>
                        Detalhes
                      </Button>
                      {!campaign.archivedAt ? (
                        <Button variant="secondary" onClick={() => void archiveCampaign(campaign.id)}>
                          Arquivar
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void saveCampaignName(campaign, String(form.get("name") ?? campaign.name));
                    }}
                  >
                    <Input name="name" defaultValue={campaign.name} aria-label={`Renomear ${campaign.name}`} />
                    <Button type="submit" variant="secondary">
                      Salvar nome
                    </Button>
                  </form>
                </article>
              ))}
            </div>
          )}

          {totalPages > 1 ? (
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                Anterior
              </Button>
              <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
                Próxima
              </Button>
            </div>
          ) : null}

          {detail ? (
            <Card>
              <CardHeader>
                <CardTitle>{detail.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-400">{detail.description || "Sem descrição."}</p>
                <p className="text-sm">
                  Canal: {detail.channel} · Status:{" "}
                  {CAMPAIGN_STATUS_LABELS[detail.status as keyof typeof CAMPAIGN_STATUS_LABELS] ?? detail.status}
                </p>
                <h3 className="text-sm font-semibold text-white">Oportunidades vinculadas</h3>
                {detail.deals.length === 0 ? (
                  <p className="text-sm text-slate-500">Nenhuma oportunidade associada.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-slate-300">
                    {detail.deals.map((deal) => (
                      <li key={deal.id}>
                        {deal.title} · {deal.stage.name}
                      </li>
                    ))}
                  </ul>
                )}
                <Button variant="secondary" onClick={() => setDetail(null)}>
                  Fechar
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </section>
      ) : null}

      {tab === "origins" ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Origens de venda</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-slate-400">
                Cadastre de onde vieram os contatos. Origem, meio de entrada e campanha são campos distintos.
              </p>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addOrigin(newOrigin);
                }}
              >
                <Label htmlFor="new-origin">Nova origem</Label>
                <Input
                  id="new-origin"
                  value={newOrigin}
                  onChange={(event) => setNewOrigin(event.target.value)}
                  required
                />
                <Button type="submit" disabled={saving || !newOrigin.trim()}>
                  {saving ? "Adicionando..." : "Adicionar"}
                </Button>
                {originError ? <p className="text-sm text-red-400">{originError}</p> : null}
              </form>
            </CardContent>
          </Card>
          <div>
            <div className="mb-3 flex items-center justify-end">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                />
                Mostrar inativos
              </label>
            </div>
            {originsLoading ? <p className="text-sm text-slate-400">Carregando origens...</p> : null}
            <div className="space-y-2">
              {origins.map((origin) => (
                <div key={origin.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 px-3 py-2">
                  {editingOrigin?.id === origin.id ? (
                    <form
                      className="flex flex-1 gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!token || !editingOrigin) return;
                        void api
                          .patch(`/sale-origins/${origin.id}`, { name: editingOrigin.name }, token)
                          .then(() => {
                            setEditingOrigin(null);
                            setNotice("Origem atualizada.");
                            return loadOrigins();
                          })
                          .catch((err) => setOriginError(err instanceof Error ? err.message : "Erro ao salvar."));
                      }}
                    >
                      <Input
                        value={editingOrigin.name}
                        onChange={(event) => setEditingOrigin({ id: origin.id, name: event.target.value })}
                        aria-label="Nome da origem"
                      />
                      <Button type="submit" variant="secondary">
                        Salvar
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setEditingOrigin(null)}>
                        Cancelar
                      </Button>
                    </form>
                  ) : (
                    <p className="text-sm text-white">
                      {origin.name}
                      {!origin.active ? <span className="ml-2 text-xs text-slate-500">Inativa</span> : null}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setEditingOrigin({ id: origin.id, name: origin.name })}>
                      Editar
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (!token) return;
                        void api
                          .post(`/sale-origins/${origin.id}/${origin.active ? "deactivate" : "activate"}`, {}, token)
                          .then(() => loadOrigins())
                          .catch((err) => setOriginError(err instanceof Error ? err.message : "Erro ao atualizar."));
                      }}
                    >
                      {origin.active ? "Inativar" : "Reativar"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {tab === "channels" ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {AD_CHANNELS.map((channel) => (
            <Card key={channel.id}>
              <CardHeader>
                <CardTitle>{channel.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-400">{channel.summary}</p>
                <a className="text-sm font-semibold text-amber-300" href={channel.href} target="_blank" rel="noreferrer">
                  Documentação oficial
                </a>
                <Button
                  variant="secondary"
                  onClick={() => void addOrigin(channel.originName)}
                  disabled={saving}
                >
                  Cadastrar como origem
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      {tab === "whatsapp" ? (
        <section className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Campanhas do WhatsApp</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-300">
              <p>
                Disparos usam modelos de mensagem aprovados pela Meta, no idioma correspondente, e só após número conectado.
                A associação comercial no Funil não seleciona destinatários nem inicia envio.
              </p>
              <p>
                Cobrança e categorias de conversa variam conforme a política vigente. Consulte{" "}
                <a className="text-amber-300" href="https://business.whatsapp.com/products/platform-pricing" target="_blank" rel="noreferrer">
                  preços da plataforma
                </a>{" "}
                e a{" "}
                <a className="text-amber-300" href="https://business.whatsapp.com/policy" target="_blank" rel="noreferrer">
                  política comercial
                </a>
                .
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => { setTab("overview"); setCreating(true); setDraft({ name: "", description: "", channel: "WHATSAPP" }); }}>
                  Nova campanha
                </Button>
                <Button variant="secondary" onClick={() => setTab("overview")}>
                  Voltar
                </Button>
                <Link className="inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold text-amber-200" href="/inbox">
                  Chat
                </Link>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2" aria-label="Período do relatório">
            {[
              ["7d", "Últimos 7 dias"],
              ["30d", "Últimos 30 dias"],
              ["90d", "Últimos 90 dias"],
              ["month", "Este mês"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "rounded-xl px-3 py-2 text-sm",
                  whatsappPeriod === value ? "bg-amber-400/20 text-amber-200" : "text-slate-400",
                )}
                onClick={() => setWhatsappPeriod(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {whatsappLoading ? <p className="text-sm text-slate-400">Carregando visão geral...</p> : null}
          {whatsapp ? (
            <div className="space-y-4">
              {!whatsapp.integrationAvailable ? (
                <p className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-sm text-amber-100">
                  {whatsapp.reason} Envio permanece bloqueado até a integração em Integrações.
                </p>
              ) : null}
              <p className="text-xs text-slate-500">
                Última sincronização:{" "}
                {whatsapp.lastSyncedAt
                  ? new Date(whatsapp.lastSyncedAt).toLocaleString("pt-BR")
                  : "Indisponível (sem integração ativa)"}
              </p>
              <Card>
                <CardHeader>
                  <CardTitle>Utilização do limite de mensagens</CardTitle>
                </CardHeader>
                <CardContent>
                  {whatsapp.messagingLimit ? (
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-slate-400">
                        <span>
                          {whatsapp.messagingLimit.used} / {whatsapp.messagingLimit.cap}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800">
                        <div
                          className="h-2 rounded-full bg-amber-400"
                          style={{
                            width: `${Math.min(100, (whatsapp.messagingLimit.used / Math.max(whatsapp.messagingLimit.cap, 1)) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">Indisponível sem conta WhatsApp conectada. Não é zero.</p>
                  )}
                  <a
                    className="mt-2 inline-block text-sm text-amber-300"
                    href={whatsapp.docs.limits}
                    target="_blank"
                    rel="noreferrer"
                  >
                    O que são os limites?
                  </a>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Qualidade dos números conectados</CardTitle>
                </CardHeader>
                <CardContent>
                  {whatsapp.quality ? (
                    <p>{whatsapp.quality.status}</p>
                  ) : (
                    <p className="text-sm text-slate-400">Situação de qualidade indisponível até conectar um número.</p>
                  )}
                </CardContent>
              </Card>
              <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
                {[
                  ["Campanhas", whatsapp.totals.campaigns],
                  ["Enviadas", whatsapp.totals.sent],
                  ["Entregues", whatsapp.totals.delivered],
                  ["Lidas", whatsapp.totals.read],
                  ["Responderam", whatsapp.totals.responded],
                  ["Falhas", whatsapp.totals.failed],
                  ["Na fila", whatsapp.totals.queued],
                ].map(([label, value]) => (
                  <Card key={String(label)}>
                    <CardContent className="pt-5">
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="text-2xl font-semibold text-white">{value as number}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Entregues: {formatRate(whatsapp.rates.delivered)} · Lidas: {formatRate(whatsapp.rates.read)} ·
                Responderam: {formatRate(whatsapp.rates.responded)} · Falhas: {formatRate(whatsapp.rates.failed)}
              </p>
              <p className="text-xs text-slate-500">{whatsapp.definitions.responded}</p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
