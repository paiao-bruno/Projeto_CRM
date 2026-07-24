import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkArray } from "./batch.util";

describe("batch.util", () => {
  it("splits arrays into fixed-size chunks", () => {
    assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunkArray([], 10), []);
  });
});
