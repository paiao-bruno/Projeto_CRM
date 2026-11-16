"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import type { Customer, PaginatedResponse } from "@/lib/types";
import { ErrorAlert, Field, Modal, PageHeader, formatDate, statusLabels, toDateInput, useResource } from "@/components/vx";

type ContractRow = {
  id: string;
  customerId: string;
  status: string;
  planName: string | null;
  serviceLogin: string | null;
  startedAt: string | null;
  endedAt: string | null;
  origin: string | null;
  customer: { id: string; name: string };
};
const STATUSES = ["ACTIVE", "SUSPENDED", "INACTIVE", "CANCELED"] as const;
type Draft = { customerId: string; planName: string; serviceLogin: string; status: string; startedAt: string; endedAt: string };
const emptyDraft: Draft = { customerId: "", planName: "", serviceLogin: "", status: "ACTIVE", startedAt: "", endedAt: "" };

export default function ContractsPage() {
  const [search, setSearch] = useState("");
  const { data, error, loading, reload, token } = useResource<PaginatedResponse<ContractRow>>(
    `/contracts?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`,
  );
  const customers = useResource<PaginatedResponse<Customer>>("/customers?limit=200");
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || !token) return;
    setBusy(true);
    setFormError(null);
    try {
      const { customerId, ...rest } = editing.draft;
      const body = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()]));
      if (editing.id) await api.patch(`/contracts/${editing.id}`, body, token);
      else await api.post("/contracts", { ...body, customerId, status: editing.draft.status }, token);
      setEditing(null);
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: ContractRow) {
    if (!token || !window.confirm("Excluir este contrato? As faturas ligadas a ele serão mantidas, sem vínculo.")) return;
    try {
      await api.delete(`/contracts/${row.id}`, token);
      await reload();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Falha ao excluir.");
    }
  }

  const set = (field: keyof Draft) => (event: { target: { value: string } }) =>
    setEditing((current) => (current ? { ...current, draft: { ...current.draft, [field]: event.target.value } } : current));

  return (
    <div>
      <PageHeader
        title="Contratos"
        subtitle="Contratos cadastrados localmente e preservados de importações anteriores"
        actions={
          <button className="vx-btn vx-btn-primary" onClick={() => { setFormError(null); setEditing({ id: null, draft: emptyDraft }); }} type="button">
            <Plus size={15} /> Novo contrato
          </button>
        }
      />
      <div className="mb-3 max-w-sm">
        <input className="vx-input" placeholder="Buscar por cliente, plano ou login" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar contratos" />
      </div>
      <ErrorAlert message={error} />
      <div className="vx-card overflow-x-auto">
        {loading ? (
          <p className="vx-empty">Carregando...</p>
        ) : !data || data.data.length === 0 ? (
          <p className="vx-empty">{error ? "Não foi possível carregar os contratos." : "Nenhum contrato cadastrado ainda."}</p>
        ) : (
          <table className="vx-table">
            <thead>
              <tr><th>Cliente</th><th>Plano</th><th>Login</th><th>Início</th><th>Status</th><th>Origem</th><th aria-label="Ações" /></tr>
            </thead>
            <tbody>
              {data.data.map((row) => (
                <tr key={row.id}>
                  <td className="font-semibold">{row.customer.name}</td>
                  <td>{row.planName ?? "—"}</td>
                  <td>{row.serviceLogin ?? "—"}</td>
                  <td>{formatDate(row.startedAt)}</td>
                  <td><span className="vx-badge">{statusLabels[row.status] ?? row.status}</span></td>
                  <td><span className="vx-badge vx-badge-gray">{row.origin === "LOCAL" ? "Local" : "Importado"}</span></td>
                  <td className="whitespace-nowrap text-right">
                    <button className="vx-btn" aria-label="Editar contrato" onClick={() => { setFormError(null); setEditing({ id: row.id, draft: { customerId: row.customerId, planName: row.planName ?? "", serviceLogin: row.serviceLogin ?? "", status: row.status, startedAt: toDateInput(row.startedAt), endedAt: toDateInput(row.endedAt) } }); }} type="button"><Pencil size={14} /></button>{" "}
                    <button className="vx-btn vx-btn-danger" aria-label="Excluir contrato" onClick={() => void remove(row)} type="button"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing ? (
        <Modal title={editing.id ? "Editar contrato" : "Novo contrato"} onClose={() => setEditing(null)}>
          <form className="space-y-3" onSubmit={save}>
            <ErrorAlert message={formError} />
            <Field label="Cliente *">
              <select className="vx-input" required disabled={Boolean(editing.id)} value={editing.draft.customerId} onChange={set("customerId")}>
                <option value="">Selecione...</option>
                {(customers.data?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Plano"><input className="vx-input" maxLength={120} value={editing.draft.planName} onChange={set("planName")} /></Field>
              <Field label="Login do serviço"><input className="vx-input" maxLength={120} value={editing.draft.serviceLogin} onChange={set("serviceLogin")} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Status">
                <select className="vx-input" value={editing.draft.status} onChange={set("status")}>
                  {STATUSES.map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
                </select>
              </Field>
              <Field label="Início"><input className="vx-input" type="date" value={editing.draft.startedAt} onChange={set("startedAt")} /></Field>
              <Field label="Fim"><input className="vx-input" type="date" value={editing.draft.endedAt} onChange={set("endedAt")} /></Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="vx-btn" type="button" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="vx-btn vx-btn-primary" disabled={busy} type="submit">{busy ? "Salvando..." : "Salvar"}</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
