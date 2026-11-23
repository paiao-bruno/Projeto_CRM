import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cancellationCounts,
  cohortConversionRate,
  confirmedRevenue,
  convertedBaseUntil,
  createdOpportunities,
  estimatedValueCreated,
  firstConversionByDeal,
  goalAttainment,
  newConversionsInRange,
} from "./dashboard-commercial-metrics";
import { inclusiveRange } from "./dashboard-periods";

const range = inclusiveRange("2026-11-01", "2026-11-19", "America/Sao_Paulo", "custom");

function event(
  type: "CONVERSION" | "CANCELLATION",
  occurredAt: string,
  extra: { dealId?: string; customerId?: string } = {},
) {
  return {
    id: `${type}-${occurredAt}-${extra.dealId ?? extra.customerId}`,
    type,
    dealId: extra.dealId ?? null,
    customerId: extra.customerId ?? null,
    occurredAt: new Date(occurredAt),
  };
}

describe("métricas comerciais do funil", () => {
  it("conta criação uma vez e ignora reentrada em Sucesso", () => {
    const deals = [
      { id: "d1", customerId: "c1", createdAt: new Date("2026-11-05T12:00:00.000Z"), valueCents: 1000, currency: "BRL", status: "OPEN" },
      { id: "d1", customerId: "c1", createdAt: new Date("2026-11-05T12:00:00.000Z"), valueCents: 1000, currency: "BRL", status: "WON" },
    ];
    assert.equal(createdOpportunities(deals, range), 1);
    const events = [
      event("CONVERSION", "2026-11-10T12:00:00.000Z", { dealId: "d1", customerId: "c1" }),
      event("CONVERSION", "2026-11-18T12:00:00.000Z", { dealId: "d1", customerId: "c1" }),
    ];
    assert.equal(firstConversionByDeal(events).length, 1);
    assert.equal(newConversionsInRange(events, range).count, 1);
  });

  it("duas oportunidades do mesmo cliente não viram dois clientes na base", () => {
    const events = [
      event("CONVERSION", "2026-10-02T12:00:00.000Z", { dealId: "d1", customerId: "c1" }),
      event("CONVERSION", "2026-11-02T12:00:00.000Z", { dealId: "d2", customerId: "c1" }),
    ];
    const base = convertedBaseUntil(events, range.toExclusive);
    assert.equal(base.identityReliable, true);
    assert.equal(base.count, 1);
    assert.equal(newConversionsInRange(events, range).count, 0);
  });

  it("sem customerId a unidade é oportunidade em Sucesso", () => {
    const events = [event("CONVERSION", "2026-11-02T12:00:00.000Z", { dealId: "d1" })];
    const base = convertedBaseUntil(events, range.toExclusive);
    assert.equal(base.identityReliable, false);
    assert.equal(base.unit, "deals");
    assert.equal(base.count, 1);
  });

  it("conversão em Sucesso usa coorte das criadas no intervalo", () => {
    const deals = [
      { id: "old", customerId: null, createdAt: new Date("2026-10-02T12:00:00.000Z"), valueCents: 0, currency: "BRL", status: "WON" },
      { id: "new", customerId: null, createdAt: new Date("2026-11-02T12:00:00.000Z"), valueCents: 0, currency: "BRL", status: "WON" },
    ];
    const events = [
      event("CONVERSION", "2026-11-05T12:00:00.000Z", { dealId: "old" }),
      event("CONVERSION", "2026-11-06T12:00:00.000Z", { dealId: "new" }),
    ];
    const cohort = cohortConversionRate(deals, events, range);
    assert.equal(cohort.created, 1);
    assert.equal(cohort.converted, 1);
    assert.equal(cohort.rate, 1);
  });

  it("valor estimado não vira receita e zero de meta não gera cumprimento", () => {
    const deals = [
      { id: "d1", customerId: null, createdAt: new Date("2026-11-02T12:00:00.000Z"), valueCents: 1999, currency: "BRL", status: "OPEN" },
      { id: "d2", customerId: null, createdAt: new Date("2026-11-03T12:00:00.000Z"), valueCents: 0, currency: "BRL", status: "OPEN" },
    ];
    const estimated = estimatedValueCreated(deals, range);
    assert.equal(estimated.cents, 1999);
    assert.equal(estimated.missing, 1);
    assert.equal(goalAttainment(5, 0).fulfillment, null);
    assert.equal(goalAttainment(15, 10).fulfillment, 1.5);
    assert.equal(goalAttainment(8, 10).deviation, -0.2);
    const revenue = confirmedRevenue(
      [
        { dealId: "d1", amountCents: 9900, paidAt: new Date("2026-11-05T12:00:00.000Z"), reversedAt: null },
        { dealId: "d2", amountCents: 5000, paidAt: new Date("2026-11-06T12:00:00.000Z"), reversedAt: new Date("2026-11-07T12:00:00.000Z") },
        { dealId: "d3", amountCents: 1000, paidAt: new Date("2026-10-02T12:00:00.000Z"), reversedAt: null },
      ],
      range,
    );
    assert.equal(revenue.cents, 9900);
    assert.equal(revenue.count, 1);
  });

  it("cancelamento não usa oportunidade perdida e taxa usa a coorte do início", () => {
    const events = [
      event("CONVERSION", "2026-10-02T12:00:00.000Z", { dealId: "d1", customerId: "c1" }),
      event("CANCELLATION", "2026-11-05T12:00:00.000Z", { customerId: "c1" }),
      event("CANCELLATION", "2026-11-06T12:00:00.000Z", { customerId: "c2" }),
    ];
    const result = cancellationCounts(events, range);
    assert.equal(result.quantity, 2);
    assert.equal(result.startBase, 1);
    assert.equal(result.lostFromStart, 1);
    assert.equal(result.rate, 1);
  });

  it("organização sem eventos tem base zero e conversão sem amostra", () => {
    const cohort = cohortConversionRate([], [], range);
    assert.equal(cohort.created, 0);
    assert.equal(cohort.rate, null);
    assert.equal(convertedBaseUntil([], range.toExclusive).count, 0);
  });
});
