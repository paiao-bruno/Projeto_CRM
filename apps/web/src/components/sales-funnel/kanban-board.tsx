"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DealSummary, DealStage } from "@/lib/types";
import { DealCard } from "./deal-card";

type KanbanColumnProps = {
  stage: DealStage & { deals: DealSummary[]; count: number };
  allStages: DealStage[];
  onCreateInStage: (stageId: string) => void;
  onOpenDeal: (deal: DealSummary) => void;
  onMoveToStage: (deal: DealSummary, stageId: string) => void;
  onMarkLost: (deal: DealSummary) => void;
  onArchive: (deal: DealSummary) => void;
};

function KanbanColumn({
  stage,
  allStages,
  onCreateInStage,
  onOpenDeal,
  onMoveToStage,
  onMarkLost,
  onArchive,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
    data: { type: "stage", stage },
  });

  return (
    <section
      ref={setNodeRef}
      className={`flex h-full min-w-[280px] max-w-[320px] flex-col rounded-3xl border bg-slate-950/40 ${
        isOver ? "border-emerald-400/50 ring-1 ring-emerald-400/20" : "border-slate-800"
      }`}
      aria-label={`Coluna ${stage.name}`}
    >
      <header
        className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3"
        style={{ borderTopColor: stage.color ?? undefined, borderTopWidth: 3 }}
      >
        <div>
          <h2 className="font-semibold text-white">{stage.name}</h2>
          <p className="text-xs text-slate-500">{stage.count} oportunidades</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Nova oportunidade em ${stage.name}`}
          onClick={() => onCreateInStage(stage.id)}
        >
          <Plus size={16} />
        </Button>
      </header>

      <SortableContext
        items={stage.deals.map((deal) => deal.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {stage.deals.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-800 px-3 py-6 text-center text-sm text-slate-500">
              Nenhuma oportunidade nesta etapa.
            </p>
          ) : (
            stage.deals.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                stages={allStages}
                onOpen={onOpenDeal}
                onMoveToStage={onMoveToStage}
                onMarkLost={onMarkLost}
                onArchive={onArchive}
              />
            ))
          )}
        </div>
      </SortableContext>

      <div className="border-t border-slate-800 p-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-400 transition hover:bg-slate-900 hover:text-white"
          onClick={() => onCreateInStage(stage.id)}
        >
          <Plus size={16} />
          Adicionar cartão
        </button>
      </div>
    </section>
  );
}

type KanbanBoardProps = {
  stages: Array<DealStage & { deals: DealSummary[]; count: number }>;
  onCreateInStage: (stageId: string) => void;
  onOpenDeal: (deal: DealSummary) => void;
  onMoveToStage: (deal: DealSummary, stageId: string) => void;
  onMarkLost: (deal: DealSummary) => void;
  onArchive: (deal: DealSummary) => void;
};

export function KanbanBoard({
  stages,
  onCreateInStage,
  onOpenDeal,
  onMoveToStage,
  onMarkLost,
  onArchive,
}: KanbanBoardProps) {
  const allStages = stages.map(({ deals: _deals, count: _count, ...stage }) => stage);

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-h-[520px] gap-4">
        {stages.map((stage) => (
          <KanbanColumn
            key={stage.id}
            stage={stage}
            allStages={allStages}
            onCreateInStage={onCreateInStage}
            onOpenDeal={onOpenDeal}
            onMoveToStage={onMoveToStage}
            onMarkLost={onMarkLost}
            onArchive={onArchive}
          />
        ))}
      </div>
    </div>
  );
}
