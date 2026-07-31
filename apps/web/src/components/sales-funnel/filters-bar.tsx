"use client";

import { RefreshCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DealPriority, SalesFunnelFilters, TenantMemberSummary } from "@/lib/types";
import { priorityLabels } from "@/lib/sales-funnel-utils";
import { SALES_FUNNEL_STAGES } from "@/lib/sales-funnel.constants";

type FiltersBarProps = {
  filters: SalesFunnelFilters;
  members: TenantMemberSummary[];
  onChange: (filters: SalesFunnelFilters) => void;
  onRefresh: () => void;
  loading?: boolean;
};

export function FiltersBar({
  filters,
  members,
  onChange,
  onRefresh,
  loading = false,
}: FiltersBarProps) {
  function update<K extends keyof SalesFunnelFilters>(key: K, value: SalesFunnelFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  function clearFilters() {
    onChange({});
  }

  const hasFilters = Object.values(filters).some(
    (value) => value !== undefined && value !== "" && value !== false,
  );

  return (
    <div className="space-y-4 rounded-3xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Label htmlFor="search">Pesquisar</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <Input
              id="search"
              className="pl-9"
              placeholder="Nome, telefone, e-mail, cidade..."
              value={filters.search ?? ""}
              onChange={(event) => update("search", event.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="stageCode">Etapa</Label>
          <select
            id="stageCode"
            className="h-11 min-w-40 rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100"
            value={filters.stageCode ?? ""}
            onChange={(event) => update("stageCode", event.target.value || undefined)}
          >
            <option value="">Todas</option>
            {SALES_FUNNEL_STAGES.map((stage) => (
              <option key={stage.code} value={stage.code}>
                {stage.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="ownerMemberId">Responsável</Label>
          <select
            id="ownerMemberId"
            className="h-11 min-w-44 rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100"
            value={filters.ownerMemberId ?? ""}
            onChange={(event) => update("ownerMemberId", event.target.value || undefined)}
          >
            <option value="">Todos</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName ?? member.user.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="priority">Prioridade</Label>
          <select
            id="priority"
            className="h-11 min-w-36 rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100"
            value={filters.priority ?? ""}
            onChange={(event) =>
              update("priority", (event.target.value || undefined) as DealPriority | undefined)
            }
          >
            <option value="">Todas</option>
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="createdFrom">Período inicial</Label>
          <Input
            id="createdFrom"
            type="date"
            value={filters.createdFrom?.slice(0, 10) ?? ""}
            onChange={(event) =>
              update("createdFrom", event.target.value ? `${event.target.value}T00:00:00.000Z` : undefined)
            }
          />
        </div>

        <div>
          <Label htmlFor="createdTo">Período final</Label>
          <Input
            id="createdTo"
            type="date"
            value={filters.createdTo?.slice(0, 10) ?? ""}
            onChange={(event) =>
              update("createdTo", event.target.value ? `${event.target.value}T23:59:59.999Z` : undefined)
            }
          />
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onRefresh} disabled={loading}>
            <RefreshCcw size={16} />
            Atualizar
          </Button>
          {hasFilters ? (
            <Button type="button" variant="ghost" onClick={clearFilters}>
              <X size={16} />
              Limpar filtros
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-slate-400">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(filters.includeLost)}
            onChange={(event) => update("includeLost", event.target.checked || undefined)}
          />
          Incluir perdidas
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(filters.includeArchived)}
            onChange={(event) => update("includeArchived", event.target.checked || undefined)}
          />
          Incluir arquivadas
        </label>
      </div>
    </div>
  );
}
