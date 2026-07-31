import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("frontend routes", () => {
  it("includes all primary CRM pages", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const appDir = path.join(process.cwd(), "src/app/(app)");
    const entries = await fs.readdir(appDir, { withFileTypes: true });
    const routes = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    assert.deepEqual(routes, [
      "ai-agents",
      "campaigns",
      "chat",
      "contracts",
      "customers",
      "dashboard",
      "flows",
      "integrations",
      "invoices",
      "sales-funnel",
      "schedule",
      "team-chat",
    ]);
  });
});
