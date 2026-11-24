import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPublishSnapshot,
  displayCancellations,
  isFreshSnapshot,
  isSecretMask,
  lifecycleFromState,
} from "./sgp-churn-lifecycle";
import { assertSgpClientesPayload } from "./sgp-list-payload";

describe("ciclo automático de cancelamentos", () => {
  it("máscara nunca é token e snapshot fresco respeita a janela", () => {
    assert.equal(isSecretMask("••••••"), true);
    assert.equal(isSecretMask(""), false);
    assert.equal(isSecretMask("token-real"), false);
    const now = new Date("2026-11-24T13:00:00.000Z");
    assert.equal(isFreshSnapshot(new Date("2026-11-24T12:56:00.000Z"), now, 5 * 60 * 1000), true);
    assert.equal(isFreshSnapshot(new Date("2026-11-24T12:50:00.000Z"), now, 5 * 60 * 1000), false);
  });

  it("job antigo ou de outro host não publica", () => {
    assert.equal(canPublishSnapshot(1, 2, "a.example", "a.example"), false);
    assert.equal(canPublishSnapshot(2, 2, "old.example", "new.example"), false);
    assert.equal(canPublishSnapshot(2, 2, "a.example", "a.example"), true);
  });

  it("autenticação recusada não vira zero", () => {
    assert.equal(displayCancellations(false, 0), null);
    assert.equal(displayCancellations(true, 0), 0);
    assert.equal(lifecycleFromState({ configured: true, authDenied: true, running: false, hasComplete: false, fresh: false }), "auth_denied");
  });

  it("HTTP 200 com erro de negócio não é sucesso", () => {
    assert.throws(() => assertSgpClientesPayload({ erro: "Token inválido" }), /auth_payload/);
    assert.throws(() => assertSgpClientesPayload({}), /invalid_payload/);
    assert.doesNotThrow(() => assertSgpClientesPayload({ paginacao: { total: 0 }, clientes: [] }));
  });
});
