"use client";

import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import { ErrorAlert, PageHeader, statusLabels, useResource } from "@/components/vx";

type Row = {
  id: string; protocol: string | null; status: string; closeReason: string | null;
  createdAt: string; lastMessageAt: string | null; closedAt: string | null;
  customer: { name: string; phone: string | null } | null;
  sector: { name: string } | null;
  assignee: { name: string } | null;
};
type Result = { data: Row[]; total: number; page: number; dateField: string };

export default function HistoryPage() {
  const [protocol, setProtocol] = useState("");
  const [contact, setContact] = useState("");
  const [dateField, setDateField] = useState("createdAt");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = new URLSearchParams({ dateField, limit: "50" });
  if (protocol) query.set("protocol", protocol);
  if (contact) query.set("contact", contact);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const { data, error, loading, reload, token } = useResource<Result>(`/team/history?${query}`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchMsg, setBatchMsg] = useState<string | null>(null);

  async function exportCsv(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    const file = await api.get<{ csv: string; filename: string }>(`/team/history/export?${query}`, token);
    const blob = new Blob([file.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function closeSelected() {
    if (!token || selected.size === 0) return;
    const preview = await api.post<{ found: number }>("/team/batch/preview", { ids: [...selected] }, token);
    if (!window.confirm(`Encerrar ${preview.found} atendimento(s)?`)) return;
    const result = await api.post<{ results: { ok: boolean }[] }>("/team/batch", { ids: [...selected], action: "close", reason: "resolved" }, token);
    setBatchMsg(`${result.results.filter((r) => r.ok).length} encerrado(s).`);
    setSelected(new Set());
    await reload();
  }

  return (
    <div>
      <PageHeader title="Histórico de atendimentos" subtitle="A data filtrada é a escolhida abaixo (criação, última mensagem ou encerramento)." />
      <form className="mb-4 grid gap-2 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); void reload(); }}>
        <input className="vx-input" placeholder="Protocolo" value={protocol} onChange={(e) => setProtocol(e.target.value)} />
        <input className="vx-input" placeholder="Contato ou telefone" value={contact} onChange={(e) => setContact(e.target.value)} />
        <select className="vx-input" value={dateField} onChange={(e) => setDateField(e.target.value)} aria-label="Campo de data">
          <option value="createdAt">Data de criação</option>
          <option value="lastMessageAt">Última mensagem</option>
          <option value="closedAt">Encerramento</option>
        </select>
        <input className="vx-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" />
        <input className="vx-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" />
      </form>
      <div className="mb-3 flex gap-2">
        <button className="vx-btn" type="button" onClick={() => void reload()}>Buscar</button>
        <button className="vx-btn" type="button" onClick={(e) => void exportCsv(e)}>Exportar CSV</button>
        <button className="vx-btn" type="button" disabled={selected.size === 0} onClick={() => void closeSelected()}>Encerrar selecionados</button>
      </div>
      <ErrorAlert message={error ?? batchMsg} />
      <p className="mb-2 text-sm vx-muted">Filtrando por {dateField === "createdAt" ? "criação" : dateField === "lastMessageAt" ? "última mensagem" : "encerramento"} · {data?.total ?? 0} resultado(s)</p>
      <div className="vx-card overflow-x-auto">
        {loading ? <p className="vx-empty">Carregando...</p> : (
          <table className="vx-table">
            <thead><tr><th /><th>Protocolo</th><th>Contato</th><th>Status</th><th>Setor</th><th>Responsável</th><th>Motivo</th></tr></thead>
            <tbody>
              {(data?.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td><input type="checkbox" checked={selected.has(row.id)} onChange={(e) => setSelected((cur) => { const next = new Set(cur); if (e.target.checked) next.add(row.id); else next.delete(row.id); return next; })} aria-label={`Selecionar ${row.protocol}`} /></td>
                  <td><a className="underline" href={`/inbox?c=${row.id}`}>{row.protocol ?? "—"}</a></td>
                  <td>{row.customer?.name ?? "—"}</td>
                  <td>{statusLabels[row.status] ?? row.status}</td>
                  <td>{row.sector?.name ?? "—"}</td>
                  <td>{row.assignee?.name ?? "—"}</td>
                  <td>{row.closeReason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
