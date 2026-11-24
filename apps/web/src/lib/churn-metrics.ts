import { type PeriodRange } from "./dashboard-periods";
export { defaultTwelveClosedMonths, lastClosedMonthEnd } from "./dashboard-periods";
import type { NormalizedSgpContract } from "./sgp-cancellation-parse";

export type ChurnHorizonKind = "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "annual";

export const CHURN_HORIZONS: Array<{ kind: ChurnHorizonKind; label: string }> = [
  { kind: "weekly", label: "Últimos 7 dias" },
  { kind: "biweekly", label: "Últimos 15 dias" },
  { kind: "monthly", label: "Último mês" },
  { kind: "quarterly", label: "Últimos 3 meses" },
  { kind: "semiannual", label: "Últimos 6 meses" },
  { kind: "annual", label: "Últimos 12 meses" },
];

export type ChurnRow = NormalizedSgpContract;

export function uniqueByContract(rows: ChurnRow[]) {
  const map = new Map<string, ChurnRow>();
  for (const row of rows) map.set(row.sgpContractId, row);
  return [...map.values()];
}

export function activeCustomers(rows: ChurnRow[]) {
  return new Set(rows.filter((row) => row.isActiveService).map((row) => row.sgpCustomerId));
}

export function cancelledContracts(rows: ChurnRow[], range?: Pick<PeriodRange, "from" | "toExclusive">) {
  return uniqueByContract(rows).filter((row) => {
    if (!row.isCancelled) return false;
    if (!range) return true;
    if (!row.statusDate) return false;
    return row.statusDate >= range.from && row.statusDate < range.toExclusive;
  });
}

/** Cliente perdido: sem contrato ativo (1/6/7) e com ao menos um cancelado (3). Suspenso/inativo não conta. */
export function lostCustomers(rows: ChurnRow[], range?: Pick<PeriodRange, "from" | "toExclusive">) {
  const active = activeCustomers(rows);
  const lost = new Map<string, ChurnRow>();
  for (const row of cancelledContracts(rows, range)) {
    if (active.has(row.sgpCustomerId)) continue;
    const current = lost.get(row.sgpCustomerId);
    if (!current || (row.statusDate && (!current.statusDate || row.statusDate > current.statusDate))) {
      lost.set(row.sgpCustomerId, row);
    }
  }
  return [...lost.values()];
}

export function churnRate(lostCount: number, startBase: number | null) {
  if (startBase == null || startBase <= 0) return null;
  return lostCount / startBase;
}

export function compareChurnStatus(rate: number | null, targetBp: number | null) {
  if (rate == null) return "unavailable" as const;
  if (targetBp == null) return "no_goal" as const;
  const realizedBp = Math.round(rate * 10_000);
  if (realizedBp <= targetBp) return "within" as const;
  return "above" as const;
}

export function basisPointsToRate(bp: number) {
  return bp / 10_000;
}

export function formatChurnPercent(rate: number | null) {
  if (rate == null) return "Sem base histórica";
  return `${(rate * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function reasonSlices(rows: ChurnRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.reason?.trim() ? row.reason.trim() : "Sem classificação";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = rows.length;
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);
}

export function datedCoverage(rows: ChurnRow[]) {
  return rows.some((row) => row.isCancelled && row.statusDate);
}
