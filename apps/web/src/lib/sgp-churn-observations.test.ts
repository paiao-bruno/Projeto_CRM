import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffSnapshotTransitions, intervalCrossingMonthBoundary } from "./sgp-churn-observations";

describe("transições entre fotografias SGP", () => {
  it("primeira vista de cancelado sem data é FIRST_SEEN, não data de importação", () => {
    const now = new Date("2026-11-26T13:32:03.000Z");
    const rows = diffSnapshotTransitions(
      null,
      [{ sgpCustomerId: "c", sgpContractId: "1", statusCode: 3, isCancelled: true, statusDate: null }],
      null,
      now,
    );
    assert.equal(rows[0].quality, "FIRST_SEEN");
    assert.equal(rows[0].observedFrom.toISOString(), now.toISOString());
  });

  it("ativo para cancelado entre coletas vira INTERVAL", () => {
    const from = new Date("2026-11-26T13:32:03.000Z");
    const to = new Date("2026-11-26T13:37:03.000Z");
    const rows = diffSnapshotTransitions(
      [{ sgpCustomerId: "c", sgpContractId: "1", statusCode: 1, isCancelled: false, statusDate: null }],
      [{ sgpCustomerId: "c", sgpContractId: "1", statusCode: 3, isCancelled: true, statusDate: null }],
      from,
      to,
    );
    assert.equal(rows[0].quality, "INTERVAL");
    assert.equal(rows[0].fromStatusCode, 1);
    assert.equal(intervalCrossingMonthBoundary(from, to, "America/Sao_Paulo"), false);
  });

  it("coleta incompleta ausente não vira cancelamento", () => {
    const rows = diffSnapshotTransitions(
      [{ sgpCustomerId: "c", sgpContractId: "keep", statusCode: 1, isCancelled: false, statusDate: null }],
      [],
      new Date("2026-11-26T13:00:00.000Z"),
      new Date("2026-11-26T13:05:00.000Z"),
    );
    assert.equal(rows.length, 0);
  });
});
