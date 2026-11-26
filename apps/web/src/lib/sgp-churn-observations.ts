import { CANCELLED_CODE, type NormalizedSgpContract } from "./sgp-cancellation-parse";

export type SgpChurnObservationQuality = "EXACT" | "INTERVAL" | "FIRST_SEEN";

export type SgpChurnObservationRow = {
  sgpCustomerId: string;
  sgpContractId: string;
  fromStatusCode: number | null;
  toStatusCode: number | null;
  quality: SgpChurnObservationQuality | string;
  observedFrom: Date;
  observedTo: Date;
  statusDate: Date | null;
};

type SnapshotRow = Pick<NormalizedSgpContract, "sgpCustomerId" | "sgpContractId" | "statusCode" | "isCancelled" | "statusDate">;

export function diffSnapshotTransitions(
  previous: SnapshotRow[] | null,
  current: SnapshotRow[],
  previousFinishedAt: Date | null,
  currentFinishedAt: Date,
): SgpChurnObservationRow[] {
  const prevMap = new Map((previous ?? []).map((row) => [row.sgpContractId, row]));
  const out: SgpChurnObservationRow[] = [];
  for (const row of current) {
    const prior = prevMap.get(row.sgpContractId);
    if (!prior) {
      if (row.isCancelled) {
        out.push({
          sgpCustomerId: row.sgpCustomerId,
          sgpContractId: row.sgpContractId,
          fromStatusCode: null,
          toStatusCode: row.statusCode,
          quality: row.statusDate ? "EXACT" : "FIRST_SEEN",
          observedFrom: currentFinishedAt,
          observedTo: currentFinishedAt,
          statusDate: row.statusDate,
        });
      }
      continue;
    }
    if (prior.statusCode === row.statusCode && prior.isCancelled === row.isCancelled) continue;
    const becameCancelled = row.isCancelled && !prior.isCancelled;
    const quality: SgpChurnObservationQuality = row.statusDate && becameCancelled ? "EXACT" : "INTERVAL";
    out.push({
      sgpCustomerId: row.sgpCustomerId,
      sgpContractId: row.sgpContractId,
      fromStatusCode: prior.statusCode,
      toStatusCode: row.statusCode,
      quality,
      observedFrom: previousFinishedAt ?? currentFinishedAt,
      observedTo: currentFinishedAt,
      statusDate: row.statusDate,
    });
  }
  return out;
}

export function intervalCrossingMonthBoundary(observedFrom: Date, observedTo: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" });
  return fmt.format(observedFrom) !== fmt.format(observedTo);
}

export function isCancellationObservation(row: SgpChurnObservationRow) {
  return row.toStatusCode === CANCELLED_CODE || row.quality === "EXACT";
}
