import { DealPriority, DealSummary } from "./types";

export function formatCurrency(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

export function formatPercent(rate: number | null) {
  if (rate == null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

export function ownerLabel(deal: Pick<DealSummary, "ownerMember">) {
  return deal.ownerMember?.displayName ?? deal.ownerMember?.user.name ?? "Sem responsável";
}

export function isOverdue(deal: DealSummary) {
  if (!deal.nextActionAt || deal.status !== "OPEN") return false;
  return new Date(deal.nextActionAt).getTime() < Date.now();
}

export const priorityLabels: Record<DealPriority, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  URGENT: "Urgente",
};

export const priorityVariant: Record<
  DealPriority,
  "slate" | "blue" | "amber" | "red"
> = {
  LOW: "slate",
  MEDIUM: "blue",
  HIGH: "amber",
  URGENT: "red",
};

export function buildFilterQuery(filters: Record<string, string | boolean | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "" || value === false) continue;
    params.set(key, String(value));
  }
  return params.toString();
}
