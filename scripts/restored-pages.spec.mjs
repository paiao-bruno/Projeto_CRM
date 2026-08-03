import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = join(root, "apps/web/src/app/(app)");

function readPage(name) {
  return readFileSync(join(appRoot, name, "page.tsx"), "utf8");
}

describe("restored pages web-only", () => {
  const restored = [
    {
      page: "dashboard",
      markers: ["Sincronização SGP", "Agent Memory", "Channel Distribution", "WebOnlyApiBanner"],
    },
    {
      page: "ai-agents",
      markers: ["Novo agente", "WebOnlyApiBanner", "WebOnlyDisabledHint"],
    },
    {
      page: "integrations",
      markers: ["Credenciais SGP", "Histórico de sincronizações", "WebOnlyApiBanner"],
    },
    {
      page: "chat",
      markers: ["Conversas", "WebOnlyApiBanner", "WebOnlyDisabledHint"],
    },
  ];

  for (const { page, markers } of restored) {
    it(`${page} mantém estrutura histórica com banner web-only`, () => {
      const source = readPage(page);
      assert.ok(
        !source.includes("if (webOnly) {\n    return (\n      <LegacyApiPageShell"),
        `${page} não deve substituir a página inteira`,
      );
      assert.ok(!source.includes("LegacyApiPageShell"), `${page} não deve usar LegacyApiPageShell`);
      for (const token of markers) {
        assert.ok(source.includes(token), `${page} deve conter ${token}`);
      }
    });
  }

  it("Funil/CRM/Contratos/Faturas preservados sem LegacyApiPageShell", () => {
    for (const page of ["customers", "contracts", "invoices", "sales-funnel"]) {
      const source = readPage(page);
      assert.ok(!source.includes("LegacyApiPageShell"), `${page} preservado`);
    }
  });
});

describe("web-only empty dashboard shell", () => {
  it("define shell vazio sem dados fabricados", () => {
    const source = readFileSync(
      join(root, "apps/web/src/lib/web-only-empty-states.ts"),
      "utf8",
    );
    assert.ok(source.includes("createWebOnlyDashboardShell"));
    assert.ok(source.includes('formatWebOnlyMetric'));
    assert.ok(source.includes('return "—"'));
  });
});
