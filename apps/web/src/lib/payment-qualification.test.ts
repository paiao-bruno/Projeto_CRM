import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatConversion,
  isInstallationCharge,
  isQualifyingPaidInvoice,
  successEntryBlockers,
} from "./payment-qualification";

describe("pagamento qualificável", () => {
  it("rejeita taxa de instalação e valor zerado", () => {
    assert.equal(isInstallationCharge({ origin: "LOCAL", metadata: { kind: "taxa_instalacao" } }), true);
    assert.equal(
      isQualifyingPaidInvoice({ status: "PAID", paidAt: new Date(), amountCents: 9900, origin: "LOCAL" }),
      true,
    );
    assert.equal(
      isQualifyingPaidInvoice({ status: "PAID", paidAt: new Date(), amountCents: 0, origin: "LOCAL" }),
      false,
    );
    assert.equal(
      isQualifyingPaidInvoice({
        status: "PAID",
        paidAt: new Date(),
        amountCents: 15000,
        metadata: { category: "instalacao" },
      }),
      false,
    );
    assert.equal(isQualifyingPaidInvoice({ status: "OPEN", paidAt: null, amountCents: 9900 }), false);
  });

  it("bloqueia Sucesso sem ativação ou pagamento", () => {
    assert.ok(successEntryBlockers({ currentStageCode: "ATIVACAO", hasActivationEvidence: true, hasQualifyingPayment: false }).length > 0);
    assert.ok(successEntryBlockers({ currentStageCode: "NEGOCIACAO", hasActivationEvidence: false, hasQualifyingPayment: true }).length > 0);
    assert.deepEqual(
      successEntryBlockers({ currentStageCode: "ATIVACAO", hasActivationEvidence: true, hasQualifyingPayment: true }),
      [],
    );
  });

  it("conversão sem denominador é honesta", () => {
    assert.equal(formatConversion(null), "sem base");
    assert.equal(formatConversion(Number.POSITIVE_INFINITY), "sem base");
    assert.equal(formatConversion(0), "0.0%");
  });
});
