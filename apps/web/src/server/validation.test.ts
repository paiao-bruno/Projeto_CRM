import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError } from "./http";
import { optionalUuidOrNull } from "./validation";

describe("optionalUuidOrNull", () => {
  it("omite o campo quando ausente", () => {
    assert.equal(optionalUuidOrNull({}, "campaignId"), undefined);
  });

  it("remove o vínculo com null ou string vazia", () => {
    assert.equal(optionalUuidOrNull({ campaignId: null }, "campaignId"), null);
    assert.equal(optionalUuidOrNull({ campaignId: "" }, "campaignId"), null);
  });

  it("aceita UUID e rejeita identificador inválido", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    assert.equal(optionalUuidOrNull({ campaignId: id }, "campaignId"), id);
    assert.throws(() => optionalUuidOrNull({ campaignId: "nao-e-uuid" }, "campaignId"), HttpError);
  });
});
