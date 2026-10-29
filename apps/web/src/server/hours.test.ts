import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOpenAt, parseTimezone, parseWorkingHours } from "./hours";
import { pickNext, validateParticipants } from "./distribution";
import { HttpError } from "./http";

describe("expediente", () => {
  it("sem expediente configurado fica sempre aberto", () => {
    assert.equal(isOpenAt(null, "America/Sao_Paulo"), true);
    assert.equal(isOpenAt({}, "America/Sao_Paulo"), true);
  });

  it("rejeita faixa invertida e sobreposição", () => {
    assert.throws(() => parseWorkingHours({ mon: [["18:00", "08:00"]] }), HttpError);
    assert.throws(() => parseWorkingHours({ mon: [["08:00", "12:00"], ["11:00", "13:00"]] }), HttpError);
  });

  it("avalia o fuso informado, não o da máquina", () => {
    const hours = parseWorkingHours({ wed: [["08:00", "18:00"]] });
    // 12:00 em São Paulo = 15:00 UTC em outubro (UTC-3)
    const noonBr = new Date("2026-10-21T15:00:00.000Z");
    assert.equal(isOpenAt(hours, "America/Sao_Paulo", noonBr), true);
    assert.equal(isOpenAt(hours, "America/Sao_Paulo", new Date("2026-10-21T03:00:00.000Z")), false);
  });

  it("timezone inválido falha na validação", () => {
    assert.throws(() => parseTimezone("Not/AZone"), HttpError);
    assert.equal(parseTimezone(undefined), "America/Sao_Paulo");
  });
});

describe("rodízio (contrato próprio)", () => {
  it("percentuais devem somar 100", () => {
    assert.throws(
      () =>
        validateParticipants([
          { memberId: "11111111-1111-4111-8111-111111111111", percent: 40 },
          { memberId: "22222222-2222-4222-8222-222222222222", percent: 40 },
        ]),
      HttpError,
    );
  });

  it("escolhe o de menor razão atribuído/percentual e desempata pelo id", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const pick = pickNext([
      { memberId: b, percent: 50, assignedInCycle: 0, totalAssigned: 0, eligible: true },
      { memberId: a, percent: 50, assignedInCycle: 0, totalAssigned: 0, eligible: true },
    ]);
    assert.equal(pick.memberId, a);
    assert.equal(pick.resetCycle, false);
  });

  it("fecha o ciclo quando ninguém elegível tem quota restante", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const pick = pickNext([
      { memberId: a, percent: 100, assignedInCycle: 100, totalAssigned: 100, eligible: true },
    ]);
    assert.equal(pick.memberId, a);
    assert.equal(pick.resetCycle, true);
  });

  it("sem elegível não atribui e não descarta", () => {
    const pick = pickNext([{ memberId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", percent: 100, assignedInCycle: 0, totalAssigned: 0, eligible: false }]);
    assert.equal(pick.memberId, null);
  });
});
