"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { ErrorAlert, PageHeader, useResource } from "@/components/vx";

type Board = { id: string; name: string; _count?: { cards: number } };
type BoardDetail = {
  id: string; name: string;
  columns: { id: string; name: string; color: string }[];
  cards: { id: string; columnId: string; position: number; version: number; conversationId: string; protocol: string | null; status: string; customer: { name: string } | null }[];
};

export default function BoardsPage() {
  const list = useResource<Board[]>("/boards");
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useResource<BoardDetail>(selected ? `/boards/${selected}` : null);
  const [creating, setCreating] = useState("");
  const [error, setError] = useState<string | null>(null);
  const token = list.token;

  async function create() {
    if (!token || !creating.trim()) return;
    try {
      const created = await api.post<{ id: string }>("/boards", { name: creating.trim() }, token);
      setCreating("");
      setSelected(created.id);
      await list.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha"); }
  }

  async function move(card: BoardDetail["cards"][number], columnId: string) {
    if (!token || !selected) return;
    try {
      await api.post(`/boards/${selected}/cards/${card.id}/move`, { columnId, position: card.position, expectedVersion: card.version }, token);
      await detail.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao mover"); }
  }

  return (
    <div>
      <PageHeader title="Quadro ao vivo" subtitle="Organiza atendimentos existentes. Mover um cartão não cria venda, tag nem muda o setor." />
      <ErrorAlert message={error ?? list.error ?? detail.error} />
      <div className="mb-4 flex flex-wrap gap-2">
        {(list.data ?? []).map((board) => (
          <button key={board.id} type="button" className={selected === board.id ? "vx-btn vx-btn-primary" : "vx-btn"} onClick={() => setSelected(board.id)}>
            {board.name}
          </button>
        ))}
        <input className="vx-input max-w-xs" placeholder="Novo quadro" value={creating} onChange={(e) => setCreating(e.target.value)} />
        <button className="vx-btn" type="button" onClick={() => void create()}>Criar</button>
      </div>
      {detail.data ? (
        <div className="grid gap-3 md:grid-cols-3">
          {detail.data.columns.map((column) => (
            <section key={column.id} className="vx-card p-3">
              <h2 className="mb-2 font-bold">{column.name}</h2>
              {(detail.data?.cards ?? []).filter((card) => card.columnId === column.id).map((card) => (
                <article key={card.id} className="mb-2 rounded-lg border p-2 text-sm">
                  <p className="font-semibold">{card.customer?.name ?? "Contato"}</p>
                  <p className="vx-muted">{card.protocol ?? card.conversationId.slice(0, 8)}</p>
                  <label className="mt-1 block text-xs">
                    Mover para
                    <select className="vx-input mt-1" value={card.columnId} onChange={(e) => void move(card, e.target.value)} aria-label={`Mover ${card.protocol}`}>
                      {(detail.data?.columns ?? []).map((col) => <option key={col.id} value={col.id}>{col.name}</option>)}
                    </select>
                  </label>
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <p className="vx-empty">Crie um quadro para organizar os atendimentos. A movimentação não altera o funil comercial.</p>
      )}
    </div>
  );
}
