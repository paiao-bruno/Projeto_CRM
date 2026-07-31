import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFilterQuery,
  formatCurrency,
  formatPercent,
  isOverdue,
} from "./sales-funnel-utils";

describe("sales-funnel-utils", () => {
  it("formats currency and percent safely", () => {
    assert.match(formatCurrency(150000), /R\$/);
    assert.equal(formatPercent(null), "—");
    assert.equal(formatPercent(0.256), "25.6%");
  });

  it("detects overdue next actions", () => {
    assert.equal(
      isOverdue({
        id: "1",
        title: "Teste",
        priority: "MEDIUM",
        valueCents: 0,
        status: "OPEN",
        position: 0,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stage: {
          id: "s1",
          name: "Prospecção",
          code: "PROSPECCAO",
          color: "#000",
          position: 1,
        },
        nextActionAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      true,
    );
  });

  it("builds query strings omitting empty filters", () => {
    const query = buildFilterQuery({
      search: "fibra",
      includeArchived: false,
      ownerMemberId: "",
      stageCode: "PROSPECCAO",
    });
    assert.match(query, /search=fibra/);
    assert.match(query, /stageCode=PROSPECCAO/);
    assert.doesNotMatch(query, /includeArchived/);
  });
});
