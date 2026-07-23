import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSgpIncrementalFilters,
  hashContent,
  hashCustomerInput,
  isChangedSince,
  readSgpContentHash,
  withSgpContentHash,
} from "./sgp-sync.utils";

describe("sgp-sync.utils", () => {
  it("builds stable content hashes", () => {
    const first = hashContent({ b: 2, a: 1 });
    const second = hashContent({ a: 1, b: 2 });
    const third = hashContent({ a: 1, b: 3 });

    assert.equal(first, second);
    assert.notEqual(first, third);
  });

  it("hashes customer payloads consistently", () => {
    const hash = hashCustomerInput({
      externalId: "1",
      name: "Cliente",
      document: "123",
      status: "ACTIVE",
    });

    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it("builds incremental filters from watermark date", () => {
    const filters = buildSgpIncrementalFilters(new Date("2026-07-17T12:00:00.000Z"));

    assert.equal(filters.alterado_desde, "2026-07-17T12:00:00.000Z");
    assert.equal(filters.data_alteracao_inicio, "17/07/2026");
    assert.match(String(filters.data_atualizacao_inicio), /^17\/07\/2026 /);
  });

  it("detects records changed after watermark using SGP timestamps", () => {
    const since = new Date("2026-07-17T10:00:00.000Z");

    assert.equal(
      isChangedSince({ data_alteracao: "17/07/2026 11:00:00" }, since),
      true,
    );
    assert.equal(
      isChangedSince({ data_alteracao: "17/07/2026 09:00:00" }, since),
      false,
    );
    assert.equal(isChangedSince({}, since), true);
  });

  it("stores and reads sgp content hash in metadata", () => {
    const metadata = withSgpContentHash({ source: "SGP" }, "abc123");

    assert.equal(readSgpContentHash(metadata as never), "abc123");
  });
});
