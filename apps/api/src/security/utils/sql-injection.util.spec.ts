import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { containsSqlInjectionPattern } from "./sql-injection.util";

describe("sql-injection.util", () => {
  it("detects common sql injection patterns", () => {
    assert.equal(containsSqlInjectionPattern("' OR 1=1 --"), true);
    assert.equal(containsSqlInjectionPattern("Cliente Fibra Plus"), false);
  });
});
