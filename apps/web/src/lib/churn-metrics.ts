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

export const UNCLASSIFIED_REASON = "Sem classificação";

/** Cartões ancorados no fim do filtro, não no relógio de hoje. */
export const CHURN_HORIZONS: Array<{ kind: ChurnHorizonKind; label: string }> = [
  { kind: "weekly", label: "Últimos 7 dias até a referência" },
  { kind: "biweekly", label: "Últimos 15 dias até a referência" },
  { kind: "monthly", label: "Mês da referência" },
  { kind: "quarterly", label: "3 meses até a referência" },
  { kind: "semiannual", label: "6 meses até a referência" },
  { kind: "annual", label: "12 meses até a referência" },
];

/** B(P) só com fotografia completa na fronteira. 24h cobre atraso do job, não reconstitui meses. */
export const CHURN_BASE_MAX_SKEW_MS = 24 * 60 * 60 * 1000;

export function churnHorizonLabel(kind: ChurnHorizonKind, toYmd: string, todayYmd: string, partialMonth: boolean) {
  const untilToday = toYmd === todayYmd;
  if (kind === "weekly") return untilToday ? "Últimos 7 dias" : "Últimos 7 dias até a referência";
  if (kind === "biweekly") return untilToday ? "Últimos 15 dias" : "Últimos 15 dias até a referência";
  if (kind === "monthly") {
    if (untilToday) return partialMonth ? "Mês atual" : "Mês corrente";
    return partialMonth ? "Mês da referência (parcial)" : "Mês da referência";
  }
  if (kind === "quarterly") return untilToday ? "Trimestre até hoje" : "3 meses até a referência";
  if (kind === "semiannual") return untilToday ? "Semestre até hoje" : "6 meses até a referência";
  return untilToday ? "12 meses até hoje" : "12 meses até a referência";
}

export function snapshotSupportsOpeningBase(
  finishedAt: Date | null | undefined,
  frontier: Date,
  maxSkewMs = CHURN_BASE_MAX_SKEW_MS,
) {
  if (!finishedAt) return false;
  const skew = frontier.getTime() - finishedAt.getTime();
  return skew >= 0 && skew <= maxSkewMs;
}

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
    const key = row.reason?.trim() ? row.reason.trim() : UNCLASSIFIED_REASON;
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

export function reasonInsightText(
  slices: Array<{ name: string; count: number; share: number }>,
  scope: "current_position" | "period" | "unavailable",
) {
  const total = slices.reduce((sum, item) => sum + item.count, 0);
  const unclassified = slices.find((item) => item.name === UNCLASSIFIED_REASON)?.count ?? 0;
  const classified = slices.filter((item) => item.name !== UNCLASSIFIED_REASON);
  const classifiedCount = classified.reduce((sum, item) => sum + item.count, 0);
  const prefix =
    scope === "current_position" ? "Na posição atual, " : scope === "period" ? "No período do filtro, " : "";
  if (!total) {
    return `${prefix}não há contratos na unidade da rosca para classificar motivos.`;
  }
  if (!classifiedCount) {
    return `${prefix}todos os ${total} contratos estão sem classificação (motivo_status vazio).`;
  }
  const top = classified[0];
  const sharePct = (value: number) => `${((value / total) * 100).toFixed(1)}%`;
  const head = `${prefix}${classifiedCount} contrato(s) com motivo informado; predominante: ${top.name} (${sharePct(top.count)} da rosca)`;
  if (!unclassified) return `${head}.`;
  return `${head}. ${unclassified} (${sharePct(unclassified)}) sem classificação.`;
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
