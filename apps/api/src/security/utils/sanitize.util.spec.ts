import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizePlainText } from "./sanitize.util";

describe("sanitize.util", () => {
  it("removes html tags from plain text", () => {
    assert.equal(
      sanitizePlainText('<script>alert("xss")</script>Cliente'),
      "Cliente",
    );
  });
});
