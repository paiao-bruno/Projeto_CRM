"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import type { Customer, PaginatedResponse } from "@/lib/types";
import { ErrorAlert, Field, Modal, PageHeader, statusLabels, useResource } from "@/components/vx";

const STATUSES = ["PROSPECT", "ACTIVE", "INACTIVE", "OVERDUE", "CHURNED"] as const;
type Draft = { name: string; document: string; email: string; phone: string; planName: string; status: string };
const emptyDraft: Draft = { name: "", document: "", email: "", phone: "", planName: "", status: "PROSPECT" };

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const { data, error, loading, reload, token } = useResource<PaginatedResponse<Customer>>(
    `/customers?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`,
  );
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || !token) return;
    setBusy(true);
    setFormError(null);
    try {
      const body = Object.fromEntries(Object.entries(editing.draft).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()]));
      if (editing.id) await api.patch(`/customers/${editing.id}`, body, token);
      else await api.post("/customers", body, token);
      setEditing(null);
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(customer: Customer) {
    if (!token || !window.confirm(`Excluir ${customer.name}? Contratos e faturas locais deste cliente também serão ocultados.`)) return;
    try {
      await api.delete(`/customers/${customer.id}`, token);
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
        title="CRM / Clientes"
        subtitle="Cadastro local da organização"
        actions={
          <button className="vx-btn vx-btn-primary" onClick={() => { setFormError(null); setEditing({ id: null, draft: emptyDraft }); }} type="button">
            <Plus size={15} /> Novo cliente
          </button>
        }
      />
      <div className="mb-3 max-w-sm">
        <input className="vx-input" placeholder="Buscar por nome, documento, e-mail ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar clientes" />
      </div>
      <ErrorAlert message={error} />
      <div className="vx-card overflow-x-auto">
        {loading ? (
          <p className="vx-empty">Carregando...</p>
        ) : !data || data.data.length === 0 ? (
          <p className="vx-empty">{error ? "Não foi possível carregar os clientes." : "Nenhum cliente cadastrado ainda. Use “Novo cliente” para começar."}</p>
        ) : (
          <table className="vx-table">
            <thead>
              <tr><th>Nome</th><th>Documento</th><th>Contato</th><th>Plano</th><th>Status</th><th aria-label="Ações" /></tr>
            </thead>
            <tbody>
              {data.data.map((customer) => (
                <tr key={customer.id}>
                  <td className="font-semibold">{customer.name}</td>
                  <td>{customer.document ?? "—"}</td>
                  <td>{customer.email ?? customer.phone ?? "—"}</td>
                  <td>{customer.planName ?? "—"}</td>
                  <td><span className="vx-badge">{statusLabels[customer.status] ?? customer.status}</span></td>
                  <td className="whitespace-nowrap text-right">
                    <button className="vx-btn" aria-label={`Editar ${customer.name}`} onClick={() => { setFormError(null); setEditing({ id: customer.id, draft: { name: customer.name, document: customer.document ?? "", email: customer.email ?? "", phone: customer.phone ?? "", planName: customer.planName ?? "", status: customer.status } }); }} type="button"><Pencil size={14} /></button>{" "}
                    <button className="vx-btn vx-btn-danger" aria-label={`Excluir ${customer.name}`} onClick={() => void remove(customer)} type="button"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data ? <p className="mt-2 text-xs vx-muted">{data.total} cliente(s)</p> : null}

      {editing ? (
        <Modal title={editing.id ? "Editar cliente" : "Novo cliente"} onClose={() => setEditing(null)}>
          <form className="space-y-3" onSubmit={save}>
            <ErrorAlert message={formError} />
            <Field label="Nome *"><input className="vx-input" required maxLength={160} value={editing.draft.name} onChange={set("name")} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Documento"><input className="vx-input" maxLength={32} value={editing.draft.document} onChange={set("document")} /></Field>
              <Field label="Telefone"><input className="vx-input" maxLength={40} value={editing.draft.phone} onChange={set("phone")} /></Field>
            </div>
            <Field label="E-mail"><input className="vx-input" type="email" value={editing.draft.email} onChange={set("email")} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Plano"><input className="vx-input" maxLength={120} value={editing.draft.planName} onChange={set("planName")} /></Field>
              <Field label="Status">
                <select className="vx-input" value={editing.draft.status} onChange={set("status")}>
                  {STATUSES.map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
                </select>
              </Field>
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
