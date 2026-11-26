import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cancelledContracts,
  churnRate,
  cohortChurn,
  compareChurnStatus,
  formatChurnPercent,
  lostCustomers,
  reasonSlices,
  temporalCancellations,
} from "./churn-metrics";
import { inclusiveRange } from "./dashboard-periods";
import type { NormalizedSgpContract } from "./sgp-cancellation-parse";

function row(partial: Partial<NormalizedSgpContract> & Pick<NormalizedSgpContract, "sgpCustomerId" | "sgpContractId">): NormalizedSgpContract {
  return {
    statusCode: 3,
    statusLabel: "Cancelado",
    reason: null,
    planName: null,
    statusDate: null,
    isCancelled: true,
    isActiveService: false,
    ...partial,
  };
}

describe("métricas de churn", () => {
  it("cliente com um contrato cancelado e outro ativo não é perda de cliente", () => {
    const rows = [
      row({ sgpCustomerId: "c1", sgpContractId: "x", isCancelled: true, isActiveService: false }),
      row({ sgpCustomerId: "c1", sgpContractId: "y", isCancelled: false, isActiveService: true, statusCode: 1, statusLabel: "Ativo" }),
    ];
    assert.equal(cancelledContracts(rows).length, 1);
    assert.equal(lostCustomers(rows).length, 0);
  });

  it("status 2, 4 e 5 não geram cancelamento", () => {
    const rows = [
      row({ sgpCustomerId: "a", sgpContractId: "2", isCancelled: false, isActiveService: false, statusCode: 2, statusLabel: "Inativo" }),
      row({ sgpCustomerId: "b", sgpContractId: "4", isCancelled: false, isActiveService: false, statusCode: 4, statusLabel: "Suspenso" }),
      row({ sgpCustomerId: "c", sgpContractId: "5", isCancelled: false, isActiveService: false, statusCode: 5, statusLabel: "Inviabilidade Técnica" }),
    ];
    assert.equal(cancelledContracts(rows).length, 0);
    assert.equal(lostCustomers(rows).length, 0);
  });

  it("meta 0% é configurada e taxa nula não marca Dentro", () => {
    assert.equal(compareChurnStatus(0, 0), "within");
    assert.equal(compareChurnStatus(null, 0), "unavailable");
    assert.equal(compareChurnStatus(0.02, null), "no_goal");
  });

  it("motivo vazio vai para Sem classificação, distinto de Outros", () => {
    const slices = reasonSlices([
      row({ sgpCustomerId: "1", sgpContractId: "a", reason: "Outros" }),
      row({ sgpCustomerId: "2", sgpContractId: "b", reason: null }),
      row({ sgpCustomerId: "3", sgpContractId: "c", reason: "  " }),
    ]);
    assert.equal(slices.find((item) => item.name === "Sem classificação")?.count, 2);
    assert.equal(slices.find((item) => item.name === "Outros")?.count, 1);
  });

  it("data de cadastro/fora do intervalo não entra no recorte com data de status", () => {
    const range = inclusiveRange("2026-11-01", "2026-11-19", "America/Sao_Paulo", "custom");
    const rows = [
      row({ sgpCustomerId: "1", sgpContractId: "a", statusDate: new Date("2026-11-05T12:00:00.000Z") }),
      row({ sgpCustomerId: "2", sgpContractId: "b", statusDate: new Date("2026-10-05T12:00:00.000Z") }),
    ];
    assert.equal(cancelledContracts(rows, range).length, 1);
  });

  it("sem B(P) a taxa fica nula mesmo com cancelamentos, inclusive de novos no período", () => {
    const range = inclusiveRange("2026-10-01", "2026-10-31", "America/Sao_Paulo", "month");
    const rows = [
      row({ sgpCustomerId: "new", sgpContractId: "n", statusDate: new Date("2026-10-20T15:00:00.000Z") }),
    ];
    const total = lostCustomers(rows, range).length;
    assert.equal(total, 1);
    assert.equal(churnRate(total, null), null);
    assert.equal(churnRate(1, 0), null);
  });

  it("igualdade à meta usa pontos-base arredondados; meta mensal é independente da anual", () => {
    assert.equal(compareChurnStatus(0.01504, 150), "within");
    assert.equal(compareChurnStatus(0.016, 150), "above");
    assert.equal(compareChurnStatus(0.016, 180), "within");
  });

  it("Novo (6) não é serviço ativo, mas ainda vincula o cliente e evita perda", () => {
    const rows = [
      row({ sgpCustomerId: "n", sgpContractId: "old", isCancelled: true, isActiveService: false, statusCode: 3 }),
      row({
        sgpCustomerId: "n",
        sgpContractId: "new",
        isCancelled: false,
        isActiveService: false,
        statusCode: 6,
        statusLabel: "Novo",
      }),
    ];
    assert.equal(lostCustomers(rows).length, 0);
  });

  it("cartões temporais não repetem o estoque quando falta data", () => {
    const range = inclusiveRange("2026-11-20", "2026-11-26", "America/Sao_Paulo", "7d");
    const rows = [
      row({ sgpCustomerId: "1", sgpContractId: "a", statusDate: null }),
      row({ sgpCustomerId: "2", sgpContractId: "b", statusDate: null }),
    ];
    const temporal = temporalCancellations({ ready: true, rows, range });
    assert.equal(temporal.value, null);
    assert.equal(cancelledContracts(rows).length, 2);
  });

  it("evento com data no período não mistura cancelamento anterior nem contrato sem data", () => {
    const range = inclusiveRange("2026-11-01", "2026-11-26", "America/Sao_Paulo", "month");
    const rows = [
      row({ sgpCustomerId: "1", sgpContractId: "in", statusDate: new Date("2026-11-10T15:00:00.000Z") }),
      row({ sgpCustomerId: "2", sgpContractId: "before", statusDate: new Date("2026-10-10T15:00:00.000Z") }),
      row({ sgpCustomerId: "3", sgpContractId: "undated", statusDate: null }),
    ];
    const temporal = temporalCancellations({ ready: true, rows, range });
    assert.equal(temporal.value, 1);
    assert.equal(temporal.coverage, "partial");
  });

  it("denominador zero ou ausente não vira 0%; churn da coorte ignora aquisição do período", () => {
    assert.equal(churnRate(1, 0), null);
    assert.equal(cohortChurn({ startActiveContractIds: ["old"], cancelledContractIds: ["new", "old"] }), 1);
    assert.equal(cohortChurn({ startActiveContractIds: null, cancelledContractIds: ["old"] }), null);
    assert.equal(formatChurnPercent(null), "Taxa indisponível");
  });

  it("transição INTERVAL só conta se o intervalo inteiro cabe no recorte", () => {
    const range = inclusiveRange("2026-11-01", "2026-11-30", "America/Sao_Paulo", "month");
    const temporal = temporalCancellations({
      ready: true,
      rows: [row({ sgpCustomerId: "1", sgpContractId: "x", statusDate: null })],
      range,
      observations: [
        {
          sgpCustomerId: "1",
          sgpContractId: "x",
          fromStatusCode: 1,
          toStatusCode: 3,
          quality: "INTERVAL",
          observedFrom: new Date("2026-10-31T03:00:00.000Z"),
          observedTo: new Date("2026-11-02T03:00:00.000Z"),
          statusDate: null,
        },
      ],
    });
    assert.equal(temporal.value, null);
  });

  it("reativação na fotografia atual deixa de contar como cliente perdido", () => {
    const rows = [
      row({
        sgpCustomerId: "r",
        sgpContractId: "1",
        isCancelled: false,
        isActiveService: true,
        statusCode: 1,
        statusLabel: "Ativo",
      }),
    ];
    assert.equal(lostCustomers(rows).length, 0);
  });
});
