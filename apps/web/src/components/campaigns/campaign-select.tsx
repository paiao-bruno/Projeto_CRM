"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { CAMPAIGN_CHANNEL_LABELS, CAMPAIGN_STATUS_LABELS } from "@/lib/campaigns";
import type { DealCampaignSummary } from "@/lib/types";

type PagedCampaigns = {
  data: Array<DealCampaignSummary & { archivedAt?: string | null }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type CampaignSelectProps = {
  token: string | null;
  value: string;
  selected?: DealCampaignSummary | null;
  disabled?: boolean;
  id?: string;
  compact?: boolean;
  onChange: (campaignId: string, campaign: DealCampaignSummary | null) => void;
};

export function campaignOptionLabel(campaign: DealCampaignSummary) {
  const status =
    CAMPAIGN_STATUS_LABELS[campaign.status as keyof typeof CAMPAIGN_STATUS_LABELS] ?? campaign.status;
  const channel =
    CAMPAIGN_CHANNEL_LABELS[campaign.channel as keyof typeof CAMPAIGN_CHANNEL_LABELS] ?? campaign.channel;
  const archived = campaign.archivedAt ? " · Arquivada" : "";
  return `${campaign.name} · ${channel} · ${status}${archived}`;
}

export function CampaignSelect({
  token,
  value,
  selected,
  disabled,
  id = "campaignId",
  compact = false,
  onChange,
}: CampaignSelectProps) {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<DealCampaignSummary[]>(selected ? [selected] : []);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    const handle = window.setTimeout(() => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        page: String(page),
        limit: compact ? "20" : "50",
        includeArchived: "true",
      });
      if (search.trim()) params.set("search", search.trim());
      if (value) params.append("ids", value);
      api
        .get<PagedCampaigns>(`/campaigns?${params.toString()}`, token)
        .then((result) => {
          setTotalPages(result.totalPages);
          setItems((current) => {
            const incoming = page === 1 ? result.data : [...current, ...result.data];
            const map = new Map(incoming.map((item) => [item.id, item]));
            if (selected && !map.has(selected.id)) map.set(selected.id, selected);
            return [...map.values()];
          });
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Não foi possível carregar campanhas.");
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [token, search, page, value, selected, compact]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const options = useMemo(() => {
    const map = new Map(items.map((item) => [item.id, item]));
    if (selected && !map.has(selected.id)) map.set(selected.id, selected);
    return [...map.values()];
  }, [items, selected]);

  return (
    <div
      className="space-y-1"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Pesquisar campanhas"
        aria-label="Pesquisar campanhas"
        className="h-9 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100"
        disabled={disabled || !token}
      />
      <select
        id={id}
        aria-label="Campanha"
        className="h-11 w-full max-w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100"
        value={value}
        disabled={disabled || !token || loading}
        onChange={(event) => {
          const next = event.target.value;
          const campaign = options.find((item) => item.id === next) ?? null;
          onChange(next, campaign);
        }}
      >
        <option value="">Sem campanha</option>
        {options.map((campaign) => (
          <option key={campaign.id} value={campaign.id}>
            {campaignOptionLabel(campaign)}
          </option>
        ))}
      </select>
      {loading ? <p className="text-xs text-slate-500">Carregando campanhas...</p> : null}
      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && options.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhuma campanha cadastrada nesta organização.</p>
      ) : null}
      {page < totalPages ? (
        <button
          type="button"
          className="text-xs font-semibold text-amber-300"
          onClick={() => setPage((current) => current + 1)}
        >
          Carregar mais
        </button>
      ) : null}
    </div>
  );
}
