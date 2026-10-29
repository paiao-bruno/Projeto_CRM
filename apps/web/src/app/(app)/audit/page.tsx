"use client";

import { useState } from "react";
import { ErrorAlert, PageHeader, useResource } from "@/components/vx";

type Item = { id: string; action: string; entityType: string; entityId: string | null; createdAt: string; actor: { name: string; email: string } | null; metadata: unknown };
type Result = { data: Item[]; total: number };

export default function AuditPage() {
  const [action, setAction] = useState("");
  const query = new URLSearchParams({ limit: "50" });
  if (action) query.set("action", action);
  const { data, error, loading } = useResource<Result>(`/team/audit?${query}`);

  return (
    <div>
      <PageHeader title="Auditoria" subtitle="Eventos da organização. Segredos e tokens são omitidos." />
      <input className="vx-input mb-3 max-w-sm" placeholder="Filtrar ação" value={action} onChange={(e) => setAction(e.target.value)} />
      <ErrorAlert message={error} />
      <p className="mb-2 text-sm vx-muted">{data?.total ?? 0} evento(s)</p>
      <div className="vx-card overflow-x-auto">
        {loading ? <p className="vx-empty">Carregando...</p> : (
          <table className="vx-table">
            <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Recurso</th></tr></thead>
            <tbody>
              {(data?.data ?? []).map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAt).toLocaleString("pt-BR")}</td>
                  <td>{item.actor?.name ?? "sistema"}</td>
                  <td>{item.action}</td>
                  <td>{item.entityType}{item.entityId ? ` · ${item.entityId.slice(0, 8)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
