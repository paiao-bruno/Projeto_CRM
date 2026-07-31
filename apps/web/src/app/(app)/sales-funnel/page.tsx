"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KanbanBoard } from "@/components/sales-funnel/kanban-board";
import { DealCard } from "@/components/sales-funnel/deal-card";
import {
  DealDetailDialog,
  DealFormDialog,
  MarkLostDialog,
} from "@/components/sales-funnel/deal-dialog";
import { FiltersBar } from "@/components/sales-funnel/filters-bar";
import { MetricsPanel } from "@/components/sales-funnel/metrics-panel";
import { ViewTabs, type SalesFunnelView } from "@/components/sales-funnel/view-tabs";
import { formatCurrency, formatPercent } from "@/lib/sales-funnel-utils";
import { api } from "@/lib/api";
import { buildFilterQuery } from "@/lib/sales-funnel-utils";
import {
  DealDetail,
  DealSummary,
  SalesFunnelBoard,
  SalesFunnelFilters,
  SalesFunnelMetrics,
  TenantMemberSummary,
} from "@/lib/types";

function cloneBoard(board: SalesFunnelBoard): SalesFunnelBoard {
  return {
    ...board,
    stages: board.stages.map((stage) => ({
      ...stage,
      deals: [...stage.deals],
    })),
  };
}

function applyLocalMove(
  board: SalesFunnelBoard,
  dealId: string,
  targetStageId: string,
  targetPosition: number,
): SalesFunnelBoard {
  const next = cloneBoard(board);
  let movingDeal: DealSummary | undefined;

  for (const stage of next.stages) {
    const index = stage.deals.findIndex((deal) => deal.id === dealId);
    if (index >= 0) {
      movingDeal = stage.deals.splice(index, 1)[0];
      stage.count = stage.deals.length;
      break;
    }
  }

  if (!movingDeal) return board;

  const targetStage = next.stages.find((stage) => stage.id === targetStageId);
  if (!targetStage) return board;

  const updatedDeal = {
    ...movingDeal,
    stage: {
      id: targetStage.id,
      name: targetStage.name,
      code: targetStage.code,
      color: targetStage.color,
      position: targetStage.position,
    },
  };

  targetStage.deals.splice(Math.min(targetPosition, targetStage.deals.length), 0, updatedDeal);
  targetStage.count = targetStage.deals.length;
  return next;
}

export default function SalesFunnelPage() {
  const { token } = useAuth();
  const [board, setBoard] = useState<SalesFunnelBoard | null>(null);
  const [metrics, setMetrics] = useState<SalesFunnelMetrics | null>(null);
  const [members, setMembers] = useState<TenantMemberSummary[]>([]);
  const [filters, setFilters] = useState<SalesFunnelFilters>({});
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeDeal, setActiveDeal] = useState<DealSummary | null>(null);
  const [view, setView] = useState<SalesFunnelView>("board");

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [formDeal, setFormDeal] = useState<DealSummary | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string | undefined>();
  const [formError, setFormError] = useState("");
  const [formSaving, setFormSaving] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailDeal, setDetailDeal] = useState<DealDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [lostOpen, setLostOpen] = useState(false);
  const [lostDeal, setLostDeal] = useState<DealSummary | null>(null);
  const [lostError, setLostError] = useState("");
  const [lostSaving, setLostSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const defaultStageCode = useMemo(() => {
    if (!defaultStageId || !board) return undefined;
    return board.stages.find((stage) => stage.id === defaultStageId)?.code ?? undefined;
  }, [board, defaultStageId]);

  const loadBoard = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const query = buildFilterQuery(filters as Record<string, string | boolean | undefined>);
      const data = await api.get<SalesFunnelBoard>(
        `/sales-funnel/board${query ? `?${query}` : ""}`,
        token,
      );
      setBoard(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar o funil.");
    } finally {
      setLoading(false);
    }
  }, [filters, token]);

  const loadMetrics = useCallback(async () => {
    if (!token) return;
    setMetricsLoading(true);
    try {
      const query = buildFilterQuery(filters as Record<string, string | boolean | undefined>);
      const data = await api.get<SalesFunnelMetrics>(
        `/sales-funnel/metrics${query ? `?${query}` : ""}`,
        token,
      );
      setMetrics(data);
    } catch {
      setMetrics(null);
    } finally {
      setMetricsLoading(false);
    }
  }, [filters, token]);

  const loadMembers = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.get<TenantMemberSummary[]>("/sales-funnel/members", token);
      setMembers(data);
    } catch {
      setMembers([]);
    }
  }, [token]);

  useEffect(() => {
    loadMembers().catch(() => undefined);
  }, [loadMembers]);

  useEffect(() => {
    loadBoard().catch(() => undefined);
    loadMetrics().catch(() => undefined);
  }, [loadBoard, loadMetrics]);

  async function openDealDetail(deal: DealSummary) {
    if (!token) return;
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailDeal(null);
    try {
      const data = await api.get<DealDetail>(`/sales-funnel/deals/${deal.id}`, token);
      setDetailDeal(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar detalhes.");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function persistMove(deal: DealSummary, stageId: string, position: number) {
    if (!token || !board) return;
    const snapshot = cloneBoard(board);
    setBoard(applyLocalMove(board, deal.id, stageId, position));
    setError("");

    try {
      await api.post(
        `/sales-funnel/deals/${deal.id}/move`,
        { stageId, position, version: deal.version },
        token,
      );
      await Promise.all([loadBoard(), loadMetrics()]);
    } catch (err) {
      setBoard(snapshot);
      setError(err instanceof Error ? err.message : "Não foi possível mover a oportunidade.");
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const deal = board?.stages
      .flatMap((stage) => stage.deals)
      .find((item) => item.id === event.active.id);
    if (deal) setActiveDeal(deal);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDeal(null);
    if (!board || !event.over) return;

    const dealId = String(event.active.id);
    const deal = board.stages.flatMap((stage) => stage.deals).find((item) => item.id === dealId);
    if (!deal) return;

    const overData = event.over.data.current;
    const targetStageId =
      overData?.type === "stage"
        ? String(event.over.id)
        : board.stages.find((stage) => stage.deals.some((item) => item.id === event.over?.id))
            ?.id;

    if (!targetStageId) return;

    const targetStage = board.stages.find((stage) => stage.id === targetStageId);
    if (!targetStage) return;

    let targetPosition = targetStage.deals.length;
    if (overData?.type !== "stage") {
      const overIndex = targetStage.deals.findIndex((item) => item.id === event.over?.id);
      targetPosition = overIndex >= 0 ? overIndex : targetStage.deals.length;
    }

    if (deal.stage.id === targetStageId) {
      const currentIndex = targetStage.deals.findIndex((item) => item.id === deal.id);
      if (currentIndex === targetPosition) return;
    }

    void persistMove(deal, targetStageId, targetPosition);
  }

  async function handleCreate(payload: Record<string, unknown>) {
    if (!token) return;
    setFormSaving(true);
    setFormError("");
    try {
      await api.post("/sales-funnel/deals", payload, token);
      setFormOpen(false);
      await Promise.all([loadBoard(), loadMetrics()]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao criar oportunidade.");
      throw err;
    } finally {
      setFormSaving(false);
    }
  }

  async function handleUpdate(payload: Record<string, unknown>, version?: number) {
    if (!token || !formDeal) return;
    setFormSaving(true);
    setFormError("");
    try {
      await api.patch(`/sales-funnel/deals/${formDeal.id}`, { ...payload, version }, token);
      setFormOpen(false);
      await Promise.all([loadBoard(), loadMetrics()]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao salvar oportunidade.");
      throw err;
    } finally {
      setFormSaving(false);
    }
  }

  async function handleMarkLost(lossReason: string) {
    if (!token || !lostDeal) return;
    setLostSaving(true);
    setLostError("");
    try {
      await api.post(
        `/sales-funnel/deals/${lostDeal.id}/mark-lost`,
        { lossReason, version: lostDeal.version },
        token,
      );
      setLostOpen(false);
      await Promise.all([loadBoard(), loadMetrics()]);
    } catch (err) {
      setLostError(err instanceof Error ? err.message : "Erro ao marcar como perdida.");
      throw err;
    } finally {
      setLostSaving(false);
    }
  }

  async function handleRestore(deal: DealSummary) {
    if (!token) return;
    setError("");
    try {
      await api.post(`/sales-funnel/deals/${deal.id}/restore`, {}, token);
      setDetailOpen(false);
      await Promise.all([loadBoard(), loadMetrics()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao restaurar oportunidade.");
    }
  }

  async function handleArchive(deal: DealSummary) {
    if (!token) return;
    if (!window.confirm(`Arquivar a oportunidade "${deal.title}"?`)) return;
    setError("");
    try {
      await api.post(`/sales-funnel/deals/${deal.id}/archive`, {}, token);
      await Promise.all([loadBoard(), loadMetrics()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao arquivar oportunidade.");
    }
  }

  function openCreate(stageId?: string) {
    setFormMode("create");
    setFormDeal(null);
    setDefaultStageId(stageId);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(deal: DealSummary) {
    setFormMode("edit");
    setFormDeal(deal);
    setDetailOpen(false);
    setFormError("");
    setFormOpen(true);
  }

  const totalDeals = board?.stages.reduce((sum, stage) => sum + stage.count, 0) ?? 0;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Funil de Vendas</h1>
          <p className="mt-1 text-sm text-slate-400">
            Quadro Kanban compartilhado com persistência no servidor.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewTabs view={view} onChange={setView} />
          <Badge variant="blue">{totalDeals} no quadro</Badge>
          <Button onClick={() => openCreate()}>
            <Plus size={16} />
            Nova oportunidade
          </Button>
        </div>
      </div>

      <FiltersBar
        filters={filters}
        members={members}
        onChange={setFilters}
        onRefresh={() => {
          void loadBoard();
          void loadMetrics();
        }}
        loading={loading}
      />

      {error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {view === "board" && metrics && !metricsLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Abertas", value: String(metrics.totals.open) },
            { label: "Ativadas", value: String(metrics.totals.won) },
            { label: "Conversão", value: formatPercent(metrics.totals.overallConversionRate) },
            { label: "Valor estimado", value: formatCurrency(metrics.totals.estimatedValueCents) },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3"
            >
              <p className="text-xs text-slate-500">{item.label}</p>
              <p className="mt-1 text-lg font-semibold text-white">{item.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {view === "metrics" ? (
        <MetricsPanel metrics={metrics} loading={metricsLoading} />
      ) : loading ? (
        <p className="text-sm text-slate-400">Carregando quadro...</p>
      ) : !board || board.stages.every((stage) => stage.deals.length === 0) ? (
        <div className="rounded-3xl border border-dashed border-slate-800 px-6 py-16 text-center">
          <p className="text-lg font-medium text-white">Nenhuma oportunidade encontrada</p>
          <p className="mt-2 text-sm text-slate-400">
            Crie a primeira oportunidade ou ajuste os filtros aplicados.
          </p>
          <Button className="mt-4" onClick={() => openCreate()}>
            Criar oportunidade
          </Button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <KanbanBoard
            stages={board.stages}
            onCreateInStage={(stageId) => openCreate(stageId)}
            onOpenDeal={(deal) => void openDealDetail(deal)}
            onMoveToStage={(deal, stageId) => {
              const stage = board.stages.find((item) => item.id === stageId);
              void persistMove(deal, stageId, stage?.deals.length ?? 0);
            }}
            onMarkLost={(deal) => {
              setLostDeal(deal);
              setLostError("");
              setLostOpen(true);
            }}
            onArchive={(deal) => void handleArchive(deal)}
          />
          <DragOverlay>
            {activeDeal ? (
              <div className="w-[280px]">
                <DealCard
                  deal={activeDeal}
                  stages={board.stages}
                  onOpen={() => undefined}
                  onMoveToStage={() => undefined}
                  onMarkLost={() => undefined}
                  onArchive={() => undefined}
                  dragging
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <DealFormDialog
        open={formOpen}
        mode={formMode}
        initialDeal={formDeal}
        members={members}
        defaultStageCode={defaultStageCode}
        saving={formSaving}
        error={formError}
        onClose={() => setFormOpen(false)}
        onSubmit={async (payload, version) => {
          if (formMode === "create") {
            await handleCreate(payload);
          } else {
            await handleUpdate(payload, version);
          }
        }}
      />

      <DealDetailDialog
        open={detailOpen}
        deal={detailDeal}
        loading={detailLoading}
        onClose={() => setDetailOpen(false)}
        onEdit={openEdit}
        onRestore={(deal) => void handleRestore(deal)}
      />

      <MarkLostDialog
        open={lostOpen}
        deal={lostDeal}
        saving={lostSaving}
        error={lostError}
        onClose={() => setLostOpen(false)}
        onSubmit={handleMarkLost}
      />
    </div>
  );
}
