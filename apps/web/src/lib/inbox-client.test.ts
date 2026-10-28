import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPhone } from "./inbox-client";

describe("formatPhone", () => {
  it("formata celular e fixo brasileiros", () => {
    assert.equal(formatPhone("5511911112222"), "+55 11 91111-2222");
    assert.equal(formatPhone("551133334444"), "+55 11 3333-4444");
  });
  it("mantém outros formatos e trata vazio", () => {
    assert.equal(formatPhone("14155550100"), "+14155550100");
    assert.equal(formatPhone(null), "sem telefone");
  });
});
