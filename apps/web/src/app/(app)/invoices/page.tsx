"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import type { Customer, PaginatedResponse } from "@/lib/types";
import { ErrorAlert, Field, Modal, PageHeader, formatCents, formatDate, statusLabels, toDateInput, useResource } from "@/components/vx";

type InvoiceRow = {
  id: string;
  customerId: string;
  contractId: string | null;
  status: string;
  amountCents: number | null;
  dueDate: string | null;
  paidAt: string | null;
  origin: string | null;
  customer: { id: string; name: string };
};
type ContractOption = { id: string; planName: string | null; customerId: string };
const STATUSES = ["OPEN", "PAID", "OVERDUE", "CANCELED"] as const;
type Draft = { customerId: string; contractId: string; amount: string; dueDate: string; status: string };
const emptyDraft: Draft = { customerId: "", contractId: "", amount: "", dueDate: "", status: "OPEN" };

export default function InvoicesPage() {
  const [status, setStatus] = useState("");
  const { data, error, loading, reload, token } = useResource<PaginatedResponse<InvoiceRow>>(`/invoices?limit=100${status ? `&status=${status}` : ""}`);
  const customers = useResource<PaginatedResponse<Customer>>("/customers?limit=200");
  const contracts = useResource<PaginatedResponse<ContractOption>>("/contracts?limit=200");
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || !token) return;
    setBusy(true);
    setFormError(null);
    try {
      const { customerId, contractId, amount, dueDate, status: nextStatus } = editing.draft;
      const body = { amount, dueDate: dueDate || null, status: nextStatus, contractId: contractId || null };
      if (editing.id) await api.patch(`/invoices/${editing.id}`, body, token);
      else await api.post("/invoices", { ...body, customerId }, token);
      setEditing(null);
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: InvoiceRow) {
    if (!token || !window.confirm("Excluir esta fatura do cadastro local? Nenhuma cobrança externa é alterada.")) return;
    try {
      await api.delete(`/invoices/${row.id}`, token);
      await reload();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Falha ao excluir.");
    }
  }

  const set = (field: keyof Draft) => (event: { target: { value: string } }) =>
    setEditing((current) => (current ? { ...current, draft: { ...current.draft, [field]: event.target.value, ...(field === "customerId" ? { contractId: "" } : {}) } } : current));
  const customerContracts = (contracts.data?.data ?? []).filter((c) => c.customerId === editing?.draft.customerId);

  return (
    <div>
      <PageHeader
        title="Faturas"
        subtitle="Registro local de faturas. Não emite cobranças nem registra pagamentos em sistemas externos."
        actions={
          <button className="vx-btn vx-btn-primary" onClick={() => { setFormError(null); setEditing({ id: null, draft: emptyDraft }); }} type="button">
            <Plus size={15} /> Nova fatura
          </button>
        }
      />
      <div className="mb-3 max-w-xs">
        <select className="vx-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por status">
          <option value="">Todos os status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{statusLabels[s] ?? s}</option>)}
        </select>
      </div>
      <ErrorAlert message={error} />
      <div className="vx-card overflow-x-auto">
        {loading ? (
          <p className="vx-empty">Carregando...</p>
        ) : !data || data.data.length === 0 ? (
          <p className="vx-empty">{error ? "Não foi possível carregar as faturas." : "Nenhuma fatura cadastrada ainda."}</p>
        ) : (
          <table className="vx-table">
            <thead>
              <tr><th>Cliente</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Origem</th><th aria-label="Ações" /></tr>
            </thead>
            <tbody>
              {data.data.map((row) => (
                <tr key={row.id}>
                  <td className="font-semibold">{row.customer.name}</td>
                  <td>{formatCents(row.amountCents)}</td>
                  <td>{formatDate(row.dueDate)}</td>
                  <td><span className="vx-badge">{statusLabels[row.status] ?? row.status}</span></td>
                  <td><span className="vx-badge vx-badge-gray">{row.origin === "LOCAL" ? "Local" : "Importada"}</span></td>
                  <td className="whitespace-nowrap text-right">
                    <button className="vx-btn" aria-label="Editar fatura" onClick={() => { setFormError(null); setEditing({ id: row.id, draft: { customerId: row.customerId, contractId: row.contractId ?? "", amount: ((row.amountCents ?? 0) / 100).toFixed(2).replace(".", ","), dueDate: toDateInput(row.dueDate), status: row.status } }); }} type="button"><Pencil size={14} /></button>{" "}
                    <button className="vx-btn vx-btn-danger" aria-label="Excluir fatura" onClick={() => void remove(row)} type="button"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing ? (
        <Modal title={editing.id ? "Editar fatura" : "Nova fatura"} onClose={() => setEditing(null)}>
          <form className="space-y-3" onSubmit={save}>
            <ErrorAlert message={formError} />
            <Field label="Cliente *">
              <select className="vx-input" required disabled={Boolean(editing.id)} value={editing.draft.customerId} onChange={set("customerId")}>
                <option value="">Selecione...</option>
                {(customers.data?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Contrato">
              <select className="vx-input" value={editing.draft.contractId} onChange={set("contractId")}>
                <option value="">Sem contrato</option>
                {customerContracts.map((c) => <option key={c.id} value={c.id}>{c.planName ?? c.id.slice(0, 8)}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Valor (R$) *"><input className="vx-input" required inputMode="decimal" placeholder="129,90" value={editing.draft.amount} onChange={set("amount")} /></Field>
              <Field label="Vencimento"><input className="vx-input" type="date" value={editing.draft.dueDate} onChange={set("dueDate")} /></Field>
              <Field label="Status">
                <select className="vx-input" value={editing.draft.status} onChange={set("status")}>
                  {STATUSES.map((s) => <option key={s} value={s}>{statusLabels[s] ?? s}</option>)}
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
