"use client";

import { Plus, Power, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import type { AiAgent } from "@/lib/types";
import { ErrorAlert, Field, Modal, PageHeader, useResource } from "@/components/vx";

const PROVIDERS = ["OPENAI", "CLAUDE", "GEMINI"] as const;
const emptyDraft = { name: "", description: "", provider: "OPENAI", model: "", systemPrompt: "", temperature: "0.3", maxTokens: "900" };

export default function AiAgentsPage() {
  const { data, error, loading, reload, token } = useResource<AiAgent[]>("/ai-agents");
  const [draft, setDraft] = useState<typeof emptyDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!draft || !token) return;
    setBusy(true);
    setFormError(null);
    try {
      await api.post("/ai-agents", { ...draft, temperature: Number(draft.temperature), maxTokens: Number(draft.maxTokens) }, token);
      setDraft(null);
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(agent: AiAgent) {
    if (!token) return;
    try {
      await api.post(`/ai-agents/${agent.id}/toggle`, {}, token);
      await reload();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Falha ao alterar.");
    }
  }

  async function remove(agent: AiAgent) {
    if (!token || !window.confirm(`Excluir o agente ${agent.name}?`)) return;
    try {
      await api.delete(`/ai-agents/${agent.id}`, token);
      await reload();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Falha ao excluir.");
    }
  }

  const set = (field: keyof typeof emptyDraft) => (event: { target: { value: string } }) =>
    setDraft((current) => (current ? { ...current, [field]: event.target.value } : current));

  return (
    <div>
      <PageHeader
        title="Agentes"
        subtitle="Configuração dos agentes de IA da organização. Esta tela só guarda a configuração; nenhuma chamada a provedor é feita aqui."
        actions={
          <button className="vx-btn vx-btn-primary" onClick={() => { setFormError(null); setDraft(emptyDraft); }} type="button">
            <Plus size={15} /> Novo agente
          </button>
        }
      />
      <ErrorAlert message={error} />
      {loading ? (
        <p className="vx-empty">Carregando...</p>
      ) : !data || data.length === 0 ? (
        <div className="vx-card"><p className="vx-empty">{error ? "Não foi possível carregar os agentes." : "Nenhum agente configurado ainda."}</p></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((agent) => (
            <div key={agent.id} className="vx-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{agent.name}</p>
                  <p className="text-xs vx-muted">{agent.provider} · {agent.model}</p>
                </div>
                <span className={agent.status === "ACTIVE" ? "vx-badge" : "vx-badge vx-badge-gray"}>{agent.status === "ACTIVE" ? "Ativo" : "Inativo"}</span>
              </div>
              {agent.description ? <p className="mt-2 text-sm vx-muted">{agent.description}</p> : null}
              <div className="mt-3 flex gap-2">
                <button className="vx-btn" onClick={() => void toggle(agent)} type="button"><Power size={14} /> {agent.status === "ACTIVE" ? "Desativar" : "Ativar"}</button>
                <button className="vx-btn vx-btn-danger" aria-label={`Excluir ${agent.name}`} onClick={() => void remove(agent)} type="button"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {draft ? (
        <Modal title="Novo agente" onClose={() => setDraft(null)}>
          <form className="space-y-3" onSubmit={create}>
            <ErrorAlert message={formError} />
            <Field label="Nome *"><input className="vx-input" required maxLength={120} value={draft.name} onChange={set("name")} /></Field>
            <Field label="Descrição"><input className="vx-input" maxLength={1000} value={draft.description} onChange={set("description")} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provedor">
                <select className="vx-input" value={draft.provider} onChange={set("provider")}>
                  {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Modelo *"><input className="vx-input" required maxLength={120} value={draft.model} onChange={set("model")} /></Field>
            </div>
            <Field label="Instruções do sistema *"><textarea className="vx-input" required rows={5} maxLength={20000} value={draft.systemPrompt} onChange={set("systemPrompt")} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Temperatura (0–2)"><input className="vx-input" type="number" step="0.1" min="0" max="2" value={draft.temperature} onChange={set("temperature")} /></Field>
              <Field label="Máx. tokens"><input className="vx-input" type="number" min="1" max="200000" value={draft.maxTokens} onChange={set("maxTokens")} /></Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="vx-btn" type="button" onClick={() => setDraft(null)}>Cancelar</button>
              <button className="vx-btn vx-btn-primary" disabled={busy} type="submit">{busy ? "Salvando..." : "Salvar"}</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
