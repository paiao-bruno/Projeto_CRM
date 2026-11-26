import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const page = readFileSync(join(root, "src/app/(app)/dashboard/page.tsx"), "utf8");
const cancellations = readFileSync(join(root, "src/components/dashboard/cancellations-dashboard.tsx"), "utf8");
const authMe = readFileSync(join(root, "src/app/api/auth/me/route.ts"), "utf8");
const commercial = readFileSync(join(root, "src/app/api/dashboard/route.ts"), "utf8");
const churnRoute = readFileSync(join(root, "src/app/api/dashboard/churn/route.ts"), "utf8");
const workerMain = readFileSync(join(root, "src/server/outbox/worker-main.ts"), "utf8");

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

  it("Gestão de Cancelamentos atualiza sozinha sem importar no login", () => {
    assert.match(cancellations, /connectRealtime/);
    assert.match(cancellations, /churnPollIntervalMs/);
    assert.doesNotMatch(authMe, /ensure\(/);
    assert.doesNotMatch(commercial, /getDashboardChurnService/);
    assert.match(churnRoute, /after\(/);
    assert.match(churnRoute, /overview/);
    assert.match(workerMain, /tickSgpChurn/);
    assert.match(workerMain, /extraEveryMs/);
    assert.match(cancellations, /início da última tentativa do job/);
    assert.match(cancellations, /contratos atualmente cancelados/);
    assert.match(cancellations, /connectNulls=\{false\}/);
  });
});
