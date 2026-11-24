import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const page = readFileSync(join(process.cwd(), "src/app/(app)/dashboard/page.tsx"), "utf8");

describe("abas do Dashboard", () => {
  it("mantém Comercial, Operacional e Gestão de Cancelamentos nesta ordem", () => {
    const commercial = page.indexOf('label: "Comercial"');
    const operational = page.indexOf('label: "Operacional"');
    const cancellations = page.indexOf('label: "Gestão de Cancelamentos"');
    assert.ok(commercial > 0 && operational > commercial && cancellations > operational);
    assert.match(page, /CancellationsDashboard/);
    assert.match(page, /CommercialDashboard/);
    assert.match(page, /1ª resposta/);
    assert.match(page, />Abrir</);
  });
});
