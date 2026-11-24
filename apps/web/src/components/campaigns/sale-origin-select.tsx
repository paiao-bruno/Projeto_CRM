"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DealSaleOriginSummary } from "@/lib/types";

type SaleOriginSelectProps = {
  token: string | null;
  value: string;
  selected?: DealSaleOriginSummary | null;
  disabled?: boolean;
  id?: string;
  onChange: (originId: string, origin: DealSaleOriginSummary | null) => void;
};

export function SaleOriginSelect({
  token,
  value,
  selected,
  disabled,
  id = "saleOriginId",
  onChange,
}: SaleOriginSelectProps) {
  const [items, setItems] = useState<DealSaleOriginSummary[]>(selected ? [selected] : []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api
      .get<DealSaleOriginSummary[]>("/sale-origins", token)
      .then((data) => {
        const map = new Map(data.map((item) => [item.id, item]));
        if (selected && !map.has(selected.id)) map.set(selected.id, selected);
        setItems([...map.values()]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar origens."))
      .finally(() => setLoading(false));
  }, [token, selected]);

  return (
    <div className="space-y-1">
      <select
        id={id}
        aria-label="Origem de venda"
        className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100"
        value={value}
        disabled={disabled || !token || loading}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next, items.find((item) => item.id === next) ?? null);
        }}
      >
        <option value="">Sem origem de catálogo</option>
        {items.map((origin) => (
          <option key={origin.id} value={origin.id} disabled={!origin.active && origin.id !== value}>
            {origin.name}
            {!origin.active ? " (inativa)" : ""}
          </option>
        ))}
      </select>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
