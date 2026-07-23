import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSgpSeenExternalIds,
  isSgpDeletedRecord,
  isSgpManagedMetadata,
} from "./sgp-deletion.sync";

describe("sgp-deletion.sync", () => {
  it("detects deleted records from SGP flags and status", () => {
    assert.equal(isSgpDeletedRecord({ excluido: true }), true);
    assert.equal(isSgpDeletedRecord({ status: "EXCLUIDO" }), true);
    assert.equal(isSgpDeletedRecord({ status: "CANCELADO" }), false);
    assert.equal(isSgpDeletedRecord({ status: "ATIVO" }), false);
  });

  it("identifies SGP-managed metadata", () => {
    assert.equal(isSgpManagedMetadata({ source: "SGP" }), true);
    assert.equal(isSgpManagedMetadata({ source: "MANUAL" }), false);
  });

  it("tracks seen external ids during sync", () => {
    const seen = createSgpSeenExternalIds();
    seen.customers.add("1");
    seen.contracts.add("c1");
    seen.invoices.add("i1");

    assert.equal(seen.customers.has("1"), true);
    assert.equal(seen.contracts.has("c1"), true);
    assert.equal(seen.invoices.has("i1"), true);
  });
});
