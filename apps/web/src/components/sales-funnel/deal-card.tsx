"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, GripVertical, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DealSummary, DealStage } from "@/lib/types";
import {
  formatCurrency,
  isOverdue,
  ownerLabel,
  priorityLabels,
  priorityVariant,
} from "@/lib/sales-funnel-utils";
import { cn } from "@/lib/utils";

type DealCardProps = {
  deal: DealSummary;
  stages: DealStage[];
  onOpen: (deal: DealSummary) => void;
  onMoveToStage: (deal: DealSummary, stageId: string) => void;
  onMarkLost: (deal: DealSummary) => void;
  onArchive: (deal: DealSummary) => void;
  dragging?: boolean;
};

export function DealCard({
  deal,
  stages,
  onOpen,
  onMoveToStage,
  onMarkLost,
  onArchive,
  dragging = false,
}: DealCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: deal.id, data: { type: "deal", deal } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const overdue = isOverdue(deal);

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-sm transition",
        (isDragging || dragging) && "opacity-60 ring-2 ring-emerald-400/40",
        overdue && "border-amber-500/40",
      )}
      data-deal-id={deal.id}
    >
      <div className="mb-2 flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          aria-label="Arrastar oportunidade"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
        <button
          type="button"
          className="flex-1 text-left"
          onClick={() => onOpen(deal)}
        >
          <h3 className="font-semibold text-white">{deal.title}</h3>
          <p className="mt-1 text-xs text-slate-400">{ownerLabel(deal)}</p>
        </button>
        <details className="relative">
          <summary className="list-none cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-white">
            <MoreHorizontal size={16} />
          </summary>
          <div className="absolute right-0 z-20 mt-1 min-w-44 rounded-xl border border-slate-800 bg-slate-950 p-1 shadow-xl">
            <button
              type="button"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-900"
              onClick={() => onOpen(deal)}
            >
              Ver detalhes
            </button>
            {stages.map((stage) => (
              <button
                key={stage.id}
                type="button"
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-900 disabled:opacity-40"
                disabled={stage.id === deal.stage.id}
                onClick={() => onMoveToStage(deal, stage.id)}
              >
                Mover para {stage.name}
              </button>
            ))}
            <button
              type="button"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-amber-300 hover:bg-slate-900"
              onClick={() => onMarkLost(deal)}
            >
              Marcar como perdida
            </button>
            <button
              type="button"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-300 hover:bg-slate-900"
              onClick={() => onArchive(deal)}
            >
              Arquivar
            </button>
          </div>
        </details>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={priorityVariant[deal.priority]}>{priorityLabels[deal.priority]}</Badge>
        {deal.entrySource ? (
          <span className="text-xs text-slate-500">{deal.entrySource}</span>
        ) : null}
        {deal.valueCents > 0 ? (
          <span className="text-xs font-medium text-emerald-300">
            {formatCurrency(deal.valueCents)}
          </span>
        ) : null}
      </div>

      {deal.nextAction || deal.nextActionAt ? (
        <div
          className={cn(
            "mt-3 flex items-start gap-2 rounded-xl bg-slate-950/70 px-2.5 py-2 text-xs",
            overdue ? "text-amber-300" : "text-slate-400",
          )}
        >
          <CalendarClock size={14} className="mt-0.5 shrink-0" />
          <div>
            {deal.nextAction ? <p>{deal.nextAction}</p> : null}
            {deal.nextActionAt ? (
              <p className="mt-0.5 opacity-80">
                {new Date(deal.nextActionAt).toLocaleString("pt-BR")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onOpen(deal)}>
          Abrir
        </Button>
      </div>
    </article>
  );
}
