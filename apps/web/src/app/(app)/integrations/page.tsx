"use client";

import { KeyRound, Plus, Power } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import { ErrorAlert, Field, Modal, PageHeader, useResource } from "@/components/vx";

type Channel = {
  id: string;
  name: string;
  status: string;
  adapter: string;
  behavior: string | null;
  webhookPath: string;
  secretFingerprint: string | null;
  lastInboundAt: string | null;
  deliveries: Record<string, number>;
};
type Deliveries = {
  items: Array<{ id: string; status: string; attempts: number; maxAttempts: number; lastError: string | null; createdAt: string; integrationId: string | null }>;
  worker: { alive: boolean; lastSeenAt: string | null };
};

const BEHAVIORS: Record<string, string> = {
  accept: "Aceitar",
  reject_retryable: "Recusar (tentar de novo)",
  reject_permanent: "Recusar (definitivo)",
  timeout: "Tempo esgotado (resultado desconhecido)",
  throw: "Falha inesperada (resultado desconhecido)",
};
const DELIVERY_LABEL: Record<string, string> = {
  PENDING: "Aguardando envio", PROCESSING: "Processando", ACCEPTED: "Aceita", DELIVERED: "Entregue",
  READ: "Lida", FAILED: "Falhou", UNKNOWN: "Desconhecido",
};

export default function IntegrationsPage() {
  const channels = useResource<Channel[]>("/channels");
  const deliveries = useResource<Deliveries>("/channels/deliveries?limit=15");
  const token = channels.token;
  const [name, setName] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!token || name === null) return;
    setFormError(null);
    try {
      const created = await api.post<Channel & { secret: string }>("/channels", { name, adapter: "test" }, token);
      setName(null);
      setSecret({ title: `Segredo da conexão “${created.name}”`, value: created.secret });
      await channels.reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Falha ao criar.");
    }
  }

  async function patch(channel: Channel, body: Record<string, unknown>) {
    if (!token) return;
    try {
      await api.patch(`/channels/${channel.id}`, body, token);
      await channels.reload();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Falha ao atualizar.");
    }
  }

  async function rotate(channel: Channel) {
    if (!token || !window.confirm("Gerar novo segredo? O segredo atual deixa de valer imediatamente.")) return;
    try {
      const result = await api.post<{ secret: string }>(`/channels/${channel.id}/rotate-secret`, {}, token);
      setSecret({ title: `Novo segredo da conexão “${channel.name}”`, value: result.secret });
      await channels.reload();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Falha ao rotacionar.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Integrações"
        subtitle="Conexões de canal para receber e enviar mensagens"
        actions={
          <button className="vx-btn vx-btn-primary" onClick={() => { setFormError(null); setName(""); }} type="button">
            <Plus size={15} /> Nova conexão
          </button>
        }
      />
      <ErrorAlert message={channels.error} />

      <div className="vx-alert mb-4">
        Somente o adaptador de <strong>teste</strong> está disponível: ele nunca contata a rede externa. Provedores reais exigem credenciais autorizadas e homologação própria.
        A integração com o SGP foi descontinuada; registros e histórico já importados permanecem preservados.
      </div>

      {channels.loading ? (
        <p className="vx-empty">Carregando...</p>
      ) : !channels.data || channels.data.length === 0 ? (
        <div className="vx-card"><p className="vx-empty">{channels.error ? "Não foi possível carregar as conexões." : "Nenhuma conexão criada ainda."}</p></div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {channels.data.map((channel) => (
            <div key={channel.id} className="vx-card space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{channel.name}</p>
                  <p className="text-xs vx-muted">Adaptador: {channel.adapter} · segredo {channel.secretFingerprint ? `…${channel.secretFingerprint}` : "—"}</p>
                </div>
                <span className={channel.status === "ACTIVE" ? "vx-badge" : "vx-badge vx-badge-gray"}>{channel.status === "ACTIVE" ? "Ativa" : "Desativada"}</span>
              </div>
              <div>
                <span className="vx-label">URL do webhook de entrada (assinatura HMAC-SHA256 “Vértice v1”)</span>
                <code className="block break-all rounded-lg bg-slate-900 p-2 text-xs">POST {origin}{channel.webhookPath}</code>
              </div>
              {channel.adapter === "test" ? (
                <Field label="Comportamento do adaptador de teste">
                  <select className="vx-input" value={channel.behavior ?? "accept"} onChange={(e) => void patch(channel, { behavior: e.target.value })}>
                    {Object.entries(BEHAVIORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
              ) : null}
              <p className="text-xs vx-muted">
                Última entrada: {channel.lastInboundAt ? new Date(channel.lastInboundAt).toLocaleString("pt-BR") : "nunca"} ·
                Entregas: {Object.entries(channel.deliveries).map(([k, v]) => `${DELIVERY_LABEL[k] ?? k} ${v}`).join(", ") || "nenhuma"}
              </p>
              <div className="flex gap-2">
                <button className="vx-btn" onClick={() => void patch(channel, { status: channel.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })} type="button">
                  <Power size={14} /> {channel.status === "ACTIVE" ? "Desativar" : "Ativar"}
                </button>
                <button className="vx-btn" onClick={() => void rotate(channel)} type="button"><KeyRound size={14} /> Rotacionar segredo</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="vx-card mt-4 overflow-x-auto">
        <div className="flex items-center justify-between p-4 pb-2">
          <h2 className="font-bold">Entregas recentes</h2>
          <span className={deliveries.data?.worker.alive ? "vx-badge" : "vx-badge vx-badge-coral"} data-testid="worker-status">
            {deliveries.data?.worker.alive ? "Worker ativo" : "Worker parado: mensagens aguardam envio"}
          </span>
        </div>
        {!deliveries.data || deliveries.data.items.length === 0 ? (
          <p className="vx-empty">Nenhuma entrega registrada.</p>
        ) : (
          <table className="vx-table">
            <thead><tr><th>Criada</th><th>Estado</th><th>Tentativas</th><th>Detalhe</th></tr></thead>
            <tbody>
              {deliveries.data.items.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAt).toLocaleString("pt-BR")}</td>
                  <td>{DELIVERY_LABEL[item.status] ?? item.status}</td>
                  <td>{item.attempts}/{item.maxAttempts}</td>
                  <td className="vx-muted">{item.lastError ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="p-3"><button className="vx-btn" onClick={() => void deliveries.reload()} type="button">Atualizar</button></div>
      </section>

      {name !== null ? (
        <Modal title="Nova conexão" onClose={() => setName(null)}>
          <form className="space-y-3" onSubmit={create}>
            <ErrorAlert message={formError} />
            <Field label="Nome *"><input className="vx-input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <p className="text-xs vx-muted">Será criada com o adaptador de teste. O segredo é exibido uma única vez.</p>
            <div className="flex justify-end gap-2">
              <button className="vx-btn" type="button" onClick={() => setName(null)}>Cancelar</button>
              <button className="vx-btn vx-btn-primary" type="submit">Criar</button>
            </div>
          </form>
        </Modal>
      ) : null}
      {secret ? (
        <Modal title={secret.title} onClose={() => setSecret(null)}>
          <p className="mb-2 text-sm">Copie agora. Por segurança, ele não será exibido novamente.</p>
          <code className="block break-all rounded-lg bg-slate-900 p-3 text-sm" data-testid="channel-secret">{secret.value}</code>
          <div className="mt-3 flex justify-end"><button className="vx-btn vx-btn-primary" onClick={() => setSecret(null)} type="button">Já copiei</button></div>
        </Modal>
      ) : null}
    </div>
  );
}
