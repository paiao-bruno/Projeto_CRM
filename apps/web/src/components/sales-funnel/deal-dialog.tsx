"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DealDetail, DealPriority, DealSummary, TenantMemberSummary } from "@/lib/types";
import { SALES_FUNNEL_STAGES } from "@/lib/sales-funnel.constants";
import { ownerLabel, priorityLabels } from "@/lib/sales-funnel-utils";

export type DealFormValues = {
  title: string;
  phone: string;
  email: string;
  clientType: string;
  entrySource: string;
  contactType: string;
  city: string;
  neighborhood: string;
  priority: DealPriority;
  valueCents: string;
  ownerMemberId: string;
  nextAction: string;
  nextActionAt: string;
  notes: string;
  stageCode: string;
};

export const emptyDealForm = (stageCode?: string): DealFormValues => ({
  title: "",
  phone: "",
  email: "",
  clientType: "",
  entrySource: "",
  contactType: "",
  city: "",
  neighborhood: "",
  priority: "MEDIUM",
  valueCents: "",
  ownerMemberId: "",
  nextAction: "",
  nextActionAt: "",
  notes: "",
  stageCode: stageCode ?? SALES_FUNNEL_STAGES[0].code,
});

function toFormValues(deal: DealSummary): DealFormValues {
  return {
    title: deal.title,
    phone: deal.phone ?? "",
    email: deal.email ?? "",
    clientType: deal.clientType ?? "",
    entrySource: deal.entrySource ?? "",
    contactType: deal.contactType ?? "",
    city: deal.city ?? "",
    neighborhood: deal.neighborhood ?? "",
    priority: deal.priority,
    valueCents: deal.valueCents > 0 ? String(deal.valueCents / 100) : "",
    ownerMemberId: deal.ownerMember?.id ?? "",
    nextAction: deal.nextAction ?? "",
    nextActionAt: deal.nextActionAt ? deal.nextActionAt.slice(0, 16) : "",
    notes: deal.notes ?? "",
    stageCode: deal.stage.code ?? SALES_FUNNEL_STAGES[0].code,
  };
}

function toPayload(form: DealFormValues) {
  return {
    title: form.title,
    phone: form.phone || undefined,
    email: form.email || undefined,
    clientType: form.clientType || undefined,
    entrySource: form.entrySource || undefined,
    contactType: form.contactType || undefined,
    city: form.city || undefined,
    neighborhood: form.neighborhood || undefined,
    priority: form.priority,
    valueCents: form.valueCents
      ? Math.round(Number(form.valueCents.replace(",", ".")) * 100)
      : 0,
    ownerMemberId: form.ownerMemberId || undefined,
    nextAction: form.nextAction || undefined,
    nextActionAt: form.nextActionAt ? new Date(form.nextActionAt).toISOString() : undefined,
    notes: form.notes || undefined,
    stageCode: form.stageCode,
  };
}

type DealFormDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  initialDeal?: DealSummary | null;
  members: TenantMemberSummary[];
  defaultStageCode?: string;
  saving?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (payload: ReturnType<typeof toPayload>, version?: number) => Promise<void>;
};

export function DealFormDialog({
  open,
  mode,
  initialDeal,
  members,
  defaultStageCode,
  saving = false,
  error = "",
  onClose,
  onSubmit,
}: DealFormDialogProps) {
  const [form, setForm] = useState<DealFormValues>(
    emptyDealForm(defaultStageCode ?? initialDeal?.stage.code ?? undefined),
  );

  useEffect(() => {
    if (!open) return;
    setForm(
      initialDeal ? toFormValues(initialDeal) : emptyDealForm(defaultStageCode),
    );
  }, [open, initialDeal, defaultStageCode]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await onSubmit(toPayload(form), initialDeal?.version);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Nova oportunidade" : "Editar oportunidade"}
          </DialogTitle>
          <DialogDescription>
            Cadastre manualmente os dados do potencial cliente e acompanhe no funil.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4 p-6 pt-0" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="title">Nome do potencial cliente</Label>
              <Input
                id="title"
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="phone">Telefone</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="clientType">Tipo de cliente</Label>
              <Input
                id="clientType"
                value={form.clientType}
                onChange={(event) => setForm({ ...form, clientType: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="entrySource">Meio de entrada</Label>
              <Input
                id="entrySource"
                value={form.entrySource}
                onChange={(event) => setForm({ ...form, entrySource: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="contactType">Tipo de contato</Label>
              <Input
                id="contactType"
                value={form.contactType}
                onChange={(event) => setForm({ ...form, contactType: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="city">Cidade</Label>
              <Input
                id="city"
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="neighborhood">Bairro</Label>
              <Input
                id="neighborhood"
                value={form.neighborhood}
                onChange={(event) => setForm({ ...form, neighborhood: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="ownerMemberId">Responsável</Label>
              <select
                id="ownerMemberId"
                className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100"
                value={form.ownerMemberId}
                onChange={(event) => setForm({ ...form, ownerMemberId: event.target.value })}
              >
                <option value="">Sem responsável</option>
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
                className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100"
                value={form.priority}
                onChange={(event) =>
                  setForm({ ...form, priority: event.target.value as DealPriority })
                }
              >
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="valueCents">Valor estimado (R$)</Label>
              <Input
                id="valueCents"
                inputMode="decimal"
                value={form.valueCents}
                onChange={(event) => setForm({ ...form, valueCents: event.target.value })}
              />
            </div>
            {mode === "create" ? (
              <div>
                <Label htmlFor="stageCode">Etapa inicial</Label>
                <select
                  id="stageCode"
                  className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100"
                  value={form.stageCode}
                  onChange={(event) => setForm({ ...form, stageCode: event.target.value })}
                >
                  {SALES_FUNNEL_STAGES.map((stage) => (
                    <option key={stage.code} value={stage.code}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <Label htmlFor="nextAction">Próxima ação</Label>
              <Input
                id="nextAction"
                value={form.nextAction}
                onChange={(event) => setForm({ ...form, nextAction: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="nextActionAt">Data da próxima ação</Label>
              <Input
                id="nextActionAt"
                type="datetime-local"
                value={form.nextActionAt}
                onChange={(event) => setForm({ ...form, nextActionAt: event.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="notes">Observações</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </div>
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : mode === "create" ? "Criar oportunidade" : "Salvar alterações"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DealDetailDialogProps = {
  open: boolean;
  deal: DealDetail | null;
  loading?: boolean;
  onClose: () => void;
  onEdit: (deal: DealSummary) => void;
  onRestore?: (deal: DealSummary) => void;
};

export function DealDetailDialog({
  open,
  deal,
  loading = false,
  onClose,
  onEdit,
  onRestore,
}: DealDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{deal?.title ?? "Detalhes da oportunidade"}</DialogTitle>
          <DialogDescription>
            {deal ? ownerLabel(deal) : "Carregando informações..."}
          </DialogDescription>
        </DialogHeader>

        {loading || !deal ? (
          <div className="p-6 text-sm text-slate-400">Carregando detalhes...</div>
        ) : (
          <div className="space-y-6 p-6 pt-0">
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <p><span className="text-slate-500">Etapa:</span> {deal.stage.name}</p>
              <p><span className="text-slate-500">Prioridade:</span> {priorityLabels[deal.priority]}</p>
              <p><span className="text-slate-500">Telefone:</span> {deal.phone ?? "—"}</p>
              <p><span className="text-slate-500">E-mail:</span> {deal.email ?? "—"}</p>
              <p><span className="text-slate-500">Origem:</span> {deal.entrySource ?? "—"}</p>
              <p><span className="text-slate-500">Tipo de cliente:</span> {deal.clientType ?? "—"}</p>
              <p><span className="text-slate-500">Cidade:</span> {deal.city ?? "—"}</p>
              <p><span className="text-slate-500">Bairro:</span> {deal.neighborhood ?? "—"}</p>
              <p><span className="text-slate-500">Próxima ação:</span> {deal.nextAction ?? "—"}</p>
              <p>
                <span className="text-slate-500">Vencimento:</span>{" "}
                {deal.nextActionAt
                  ? new Date(deal.nextActionAt).toLocaleString("pt-BR")
                  : "—"}
              </p>
            </div>

            {deal.notes ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-white">Observações</h3>
                <p className="whitespace-pre-wrap text-sm text-slate-300">{deal.notes}</p>
              </div>
            ) : null}

            {deal.history && deal.history.length > 0 ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-white">Histórico</h3>
                <ul className="max-h-48 space-y-2 overflow-y-auto text-sm text-slate-400">
                  {deal.history.map((entry) => (
                    <li key={entry.id} className="rounded-xl border border-slate-800 px-3 py-2">
                      <p className="text-white">{entry.action}</p>
                      <p className="text-xs">
                        {entry.actor?.displayName ?? entry.actor?.user.name ?? "Sistema"} ·{" "}
                        {new Date(entry.createdAt).toLocaleString("pt-BR")}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Fechar
              </Button>
              {deal.archivedAt && onRestore ? (
                <Button variant="secondary" onClick={() => onRestore(deal)}>
                  Restaurar
                </Button>
              ) : null}
              {!deal.archivedAt && deal.status === "OPEN" ? (
                <Button onClick={() => onEdit(deal)}>Editar</Button>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type MarkLostDialogProps = {
  open: boolean;
  deal: DealSummary | null;
  saving?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (lossReason: string) => Promise<void>;
};

export function MarkLostDialog({
  open,
  deal,
  saving = false,
  error = "",
  onClose,
  onSubmit,
}: MarkLostDialogProps) {
  const [lossReason, setLossReason] = useState("");

  useEffect(() => {
    if (open) setLossReason("");
  }, [open, deal?.id]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Marcar como perdida</DialogTitle>
          <DialogDescription>
            {deal ? `Informe o motivo da perda para "${deal.title}".` : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4 p-6 pt-0"
          onSubmit={async (event) => {
            event.preventDefault();
            await onSubmit(lossReason.trim());
          }}
        >
          <div>
            <Label htmlFor="lossReason">Motivo da perda</Label>
            <Textarea
              id="lossReason"
              required
              value={lossReason}
              onChange={(event) => setLossReason(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" disabled={saving || !lossReason.trim()}>
              {saving ? "Salvando..." : "Confirmar perda"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { toPayload as dealFormToPayload };
