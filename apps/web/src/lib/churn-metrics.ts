import { type PeriodRange } from "./dashboard-periods";
export { defaultTwelveClosedMonths, lastClosedMonthEnd } from "./dashboard-periods";
import {
  ACTIVE_SERVICE_CODES,
  CANCELLED_CODE,
  RELATIONSHIP_CODES,
  type NormalizedSgpContract,
} from "./sgp-cancellation-parse";
import type { SgpChurnObservationRow } from "./sgp-churn-observations";

export type ChurnHorizonKind = "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "annual";

export const CHURN_HORIZONS: Array<{ kind: ChurnHorizonKind; label: string }> = [
  { kind: "weekly", label: "Últimos 7 dias" },
  { kind: "biweekly", label: "Últimos 15 dias" },
  { kind: "monthly", label: "Mês atual" },
  { kind: "quarterly", label: "Trimestre até hoje" },
  { kind: "semiannual", label: "Semestre até hoje" },
  { kind: "annual", label: "12 meses até hoje" },
];

export type ChurnRow = NormalizedSgpContract & { statusCode?: number | null };

export function uniqueByContract(rows: ChurnRow[]) {
  const map = new Map<string, ChurnRow>();
  for (const row of rows) map.set(row.sgpContractId, row);
  return [...map.values()];
}

export function hasActiveService(row: Pick<ChurnRow, "statusCode" | "isActiveService">) {
  if (row.statusCode != null) return ACTIVE_SERVICE_CODES.has(row.statusCode);
  return row.isActiveService;
}

export function hasRelationship(row: Pick<ChurnRow, "statusCode" | "isActiveService">) {
  if (row.statusCode != null) return RELATIONSHIP_CODES.has(row.statusCode);
  return row.isActiveService;
}

export function activeServiceContracts(rows: ChurnRow[]) {
  return uniqueByContract(rows).filter((row) => hasActiveService(row));
}

export function activeCustomers(rows: ChurnRow[]) {
  return new Set(rows.filter((row) => hasActiveService(row)).map((row) => row.sgpCustomerId));
}

export function relationshipCustomers(rows: ChurnRow[]) {
  return new Set(rows.filter((row) => hasRelationship(row)).map((row) => row.sgpCustomerId));
}

export function cancelledContracts(rows: ChurnRow[], range?: Pick<PeriodRange, "from" | "toExclusive">) {
  return uniqueByContract(rows).filter((row) => {
    if (!row.isCancelled) return false;
    if (!range) return true;
    if (!row.statusDate) return false;
    return row.statusDate >= range.from && row.statusDate < range.toExclusive;
  });
}

/** Cliente perdido: sem vínculo 1/6/7 e com ao menos um cancelado (3). Suspenso/inativo não conta. */
export function lostCustomers(rows: ChurnRow[], range?: Pick<PeriodRange, "from" | "toExclusive">) {
  const related = relationshipCustomers(rows);
  const lost = new Map<string, ChurnRow>();
  for (const row of cancelledContracts(rows, range)) {
    if (related.has(row.sgpCustomerId)) continue;
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
  if (rate == null) return "Taxa indisponível";
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

export function undatedCancelled(rows: ChurnRow[]) {
  return uniqueByContract(rows).filter((row) => row.isCancelled && !row.statusDate);
}

export type TemporalCount = {
  value: number | null;
  known: number;
  coverage: "unavailable" | "none" | "partial" | "stock_dated";
  unit: "contratos";
};

export function temporalCancellations(input: {
  ready: boolean;
  rows: ChurnRow[];
  range: Pick<PeriodRange, "from" | "toExclusive">;
  observations?: SgpChurnObservationRow[];
  coverageStartedAt?: Date | null;
}): TemporalCount {
  if (!input.ready) return { value: null, known: 0, coverage: "unavailable", unit: "contratos" };
  const cancelled = uniqueByContract(input.rows).filter((row) => row.isCancelled);
  const exact = cancelled.filter(
    (row) => row.statusDate && row.statusDate >= input.range.from && row.statusDate < input.range.toExclusive,
  );
  const intervalIds = (input.observations ?? [])
    .filter((row) => row.quality === "INTERVAL" && row.toStatusCode === CANCELLED_CODE)
    .filter((row) => row.observedFrom >= input.range.from && row.observedTo <= input.range.toExclusive)
    .map((row) => row.sgpContractId);
  const knownIds = new Set([...exact.map((row) => row.sgpContractId), ...intervalIds]);
  const known = knownIds.size;
  const undated = cancelled.filter((row) => !row.statusDate).length;
  const beforeCoverage =
    input.coverageStartedAt && input.range.toExclusive.getTime() <= input.coverageStartedAt.getTime();
  if (beforeCoverage && known === 0) {
    return { value: null, known: 0, coverage: "none", unit: "contratos" };
  }
  if (known > 0) {
    return {
      value: known,
      known,
      coverage: undated ? "partial" : "stock_dated",
      unit: "contratos",
    };
  }
  if (undated > 0) return { value: null, known: 0, coverage: "none", unit: "contratos" };
  if (!cancelled.length) return { value: 0, known: 0, coverage: "stock_dated", unit: "contratos" };
  return { value: 0, known: 0, coverage: "stock_dated", unit: "contratos" };
}

export function cohortChurn(input: {
  startActiveContractIds: string[] | null;
  cancelledContractIds: string[];
}) {
  if (!input.startActiveContractIds || input.startActiveContractIds.length === 0) return null;
  const start = new Set(input.startActiveContractIds);
  const numerator = input.cancelledContractIds.filter((id) => start.has(id)).length;
  return churnRate(numerator, start.size);
}

export function periodReasonRows(input: {
  rows: ChurnRow[];
  range: Pick<PeriodRange, "from" | "toExclusive">;
  observations?: SgpChurnObservationRow[];
  temporal: TemporalCount;
}) {
  if (input.temporal.value == null) return [];
  const intervalIds = new Set(
    (input.observations ?? [])
      .filter((row) => row.quality === "INTERVAL" && row.toStatusCode === CANCELLED_CODE)
      .filter((row) => row.observedFrom >= input.range.from && row.observedTo <= input.range.toExclusive)
      .map((row) => row.sgpContractId),
  );
  return uniqueByContract(input.rows).filter((row) => {
    if (!row.isCancelled) return false;
    if (row.statusDate && row.statusDate >= input.range.from && row.statusDate < input.range.toExclusive) return true;
    return intervalIds.has(row.sgpContractId);
  });
}
