import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractContractsFromClientesPayload,
  mapContractStatus,
  paginationFromPayload,
  SGP_CONTRACT_STATUS,
} from "./sgp-cancellation-parse";

describe("parser SGP /api/ura/clientes/", () => {
  it("não trata inativo, suspenso ou inviabilidade como cancelado", () => {
    assert.equal(mapContractStatus(2).code, SGP_CONTRACT_STATUS.INACTIVE);
    assert.equal(mapContractStatus(4).code, SGP_CONTRACT_STATUS.SUSPENDED);
    assert.equal(mapContractStatus(5).code, SGP_CONTRACT_STATUS.TECHNICAL_INVIABILITY);
    assert.equal(mapContractStatus("Cancelado").code, 3);
    assert.equal(mapContractStatus("Ativo com velocidade reduzida").code, 7);
  });

  it("expande contratos aninhados e ignora cliente sem contrato", () => {
    const rows = extractContractsFromClientesPayload({
      paginacao: { offset: 0, limit: 50, parcial: 1, total: 1 },
      clientes: [
        {
          id: 10,
          contratos: [
            { id: 1, status: "Cancelado", motivo_status: "Concorrência", data_status: "2026-10-02" },
            { id: 2, status: "Ativo", motivo_status: "" },
          ],
        },
        { id: 11, contratos: [] },
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((row) => row.isCancelled).length, 1);
    assert.equal(rows.find((row) => row.isCancelled)?.statusDate?.toISOString().slice(0, 10), "2026-10-02");
  });

  it("usa dataCancelamento do contrato e ignora a do título", () => {
    const rows = extractContractsFromClientesPayload({
      clientes: [
        {
          id: 1,
          titulos: [{ id: 9, status: "cancelado", dataCancelamento: "2024-01-01" }],
          contratos: [{ id: 2, status: 3, dataCancelamento: "2026-03-04" }],
        },
      ],
    });
    assert.equal(rows[0].statusDate?.toISOString().slice(0, 10), "2026-03-04");
  });

  it("status Novo não é serviço ativo", () => {
    assert.equal(mapContractStatus(6).code, SGP_CONTRACT_STATUS.NEW);
    const rows = extractContractsFromClientesPayload({
      clientes: [{ id: 1, contratos: [{ id: 2, status: 6 }] }],
    });
    assert.equal(rows[0].isActiveService, false);
  });

  it("não usa dataCadastro como data de cancelamento", () => {
    const rows = extractContractsFromClientesPayload({
      clientes: [{ id: 1, contratos: [{ id: 9, status: 3, dataCadastro: "2020-01-01" }] }],
    });
    assert.equal(rows[0].statusDate, null);
    assert.equal(rows[0].isCancelled, true);
  });

  it("lê paginação aninhada do payload real", () => {
    assert.deepEqual(paginationFromPayload({ paginacao: { offset: 100, limit: 50, parcial: 50, total: 1095 } }), {
      offset: 100,
      limit: 50,
      parcial: 50,
      total: 1095,
    });
  });

  it("ignora títulos e não usa vencimento nem dataCadastro como cancelamento", () => {
    const rows = extractContractsFromClientesPayload({
      clientes: [
        {
          id: 8,
          titulos: [{ id: 1, status: "Cancelado" }],
          contratos: [{ id: 80, status: 1, vencimento: 20, dataCadastro: "2020-01-01" }],
        },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].isCancelled, false);
    assert.equal(rows[0].statusDate, null);
  });
});
