import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDaysYmd,
  defaultMonthToDate,
  horizonRange,
  inclusiveRange,
  parseDashboardPeriod,
  previousRange,
  relativeChange,
  zonedDateTimeToUtc,
} from "./dashboard-periods";

describe("períodos do dashboard comercial", () => {
  it("usa meia-noite de São Paulo como início e fim exclusivo", () => {
    const range = inclusiveRange("2026-11-01", "2026-11-19", "America/Sao_Paulo", "custom");
    assert.equal(range.from.toISOString(), "2026-11-01T03:00:00.000Z");
    assert.equal(range.toExclusive.toISOString(), "2026-11-20T03:00:00.000Z");
    assert.equal(zonedDateTimeToUtc("2026-11-19", "America/Sao_Paulo").toISOString(), "2026-11-19T03:00:00.000Z");
  });

  it("mês em andamento compara o trecho equivalente, não o mês anterior completo", () => {
    const now = new Date("2026-11-19T18:00:00.000Z");
    const range = defaultMonthToDate(now, "America/Sao_Paulo");
    assert.equal(range.fromYmd, "2026-11-01");
    assert.equal(range.toYmdInclusive, "2026-11-19");
    assert.equal(range.comparisonKind, "equivalent_elapsed");
    const previous = previousRange(range.fromYmd, range.toYmdInclusive, range.comparisonKind);
    assert.deepEqual(previous, { fromYmd: "2026-10-01", toYmdInclusive: "2026-10-19" });
  });

  it("mês completo compara com o mês anterior completo", () => {
    const range = inclusiveRange("2026-10-01", "2026-10-31", "America/Sao_Paulo", "custom");
    assert.equal(range.comparisonKind, "previous_month");
    assert.deepEqual(previousRange(range.fromYmd, range.toYmdInclusive, "previous_month"), {
      fromYmd: "2026-09-01",
      toYmdInclusive: "2026-09-30",
    });
  });

  it("intervalo personalizado usa a mesma duração imediatamente anterior", () => {
    const previous = previousRange("2026-11-10", "2026-11-19", "previous_interval");
    assert.deepEqual(previous, { fromYmd: "2026-10-31", toYmdInclusive: "2026-11-09" });
    assert.equal(addDaysYmd("2026-11-01", -1), "2026-10-31");
  });

  it("não apresenta realizado futuro e trata denominador zero", () => {
    const now = new Date("2026-11-19T12:00:00.000Z");
    const range = parseDashboardPeriod({ from: "2026-11-01", to: "2026-12-31" }, now, "America/Sao_Paulo");
    assert.equal(range.toYmdInclusive, "2026-11-19");
    assert.equal(relativeChange(10, 0).kind, "none");
    assert.equal(relativeChange(12, 10).value, 20);
  });

  it("horizontes de meses usam calendário, não 90 dias", () => {
    const quarterly = horizonRange("quarterly", "2026-11-19", "America/Sao_Paulo");
    assert.equal(quarterly.fromYmd, "2026-09-01");
    assert.equal(quarterly.toYmdInclusive, "2026-11-19");
  });

  it("últimos 12 meses completos vão até o último mês fechado, não um intervalo fixo", () => {
    const range = parseDashboardPeriod(
      { preset: "last_12_closed_months" },
      new Date("2026-11-24T12:00:00.000Z"),
      "America/Sao_Paulo",
    );
    assert.equal(range.fromYmd, "2025-11-01");
    assert.equal(range.toYmdInclusive, "2026-10-31");
    assert.equal(range.preset, "last_12_closed_months");
  });
});
