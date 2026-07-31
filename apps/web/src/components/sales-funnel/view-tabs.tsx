"use client";

import { BarChart3, KanbanSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export type SalesFunnelView = "board" | "metrics";

type ViewTabsProps = {
  view: SalesFunnelView;
  onChange: (view: SalesFunnelView) => void;
};

export function ViewTabs({ view, onChange }: ViewTabsProps) {
  const tabs: Array<{ id: SalesFunnelView; label: string; icon: typeof KanbanSquare }> = [
    { id: "board", label: "Quadro", icon: KanbanSquare },
    { id: "metrics", label: "Indicadores", icon: BarChart3 },
  ];

  return (
    <div
      className="inline-flex rounded-2xl border border-slate-800 bg-slate-950/60 p-1"
      role="tablist"
      aria-label="Visualizações do funil"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = view === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
              active
                ? "bg-emerald-400 text-slate-950"
                : "text-slate-400 hover:bg-slate-900 hover:text-white",
            )}
            onClick={() => onChange(tab.id)}
          >
            <Icon size={16} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
