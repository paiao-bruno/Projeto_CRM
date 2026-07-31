#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

const shared = readText("shared/sales-funnel.constants.ts");
const webService = readText("apps/web/src/server/sales-funnel.ts");
const apiService = readText("apps/api/src/modules/sales-funnel/sales-funnel.service.ts");

const requiredCodes = [
  "PROSPECCAO",
  "VIABILIDADE",
  "NEGOCIACAO",
  "CONTRATO",
  "AGENDAMENTO",
  "ATIVACAO",
];

for (const code of requiredCodes) {
  assert.ok(shared.includes(code), `shared constants missing ${code}`);
}

for (const [label, source] of [
  ["web", webService],
  ["api", apiService],
]) {
  assert.ok(
    source.includes("SALES_FUNNEL_STAGE_CODES"),
    `${label} service must use SALES_FUNNEL_STAGE_CODES`,
  );
  assert.ok(
    source.includes("SALES_FUNNEL_STAGES"),
    `${label} service must use SALES_FUNNEL_STAGES`,
  );
  assert.ok(
    source.includes("SALES_FUNNEL_STAGE_CODES.ATIVACAO"),
    `${label} service must reference ATIVACAO stage code`,
  );
}

assert.ok(
  webService.includes("shared/sales-funnel.constants"),
  "web service must import shared/sales-funnel.constants",
);
assert.ok(
  apiService.includes("sales-funnel.constants"),
  "api service must import sales-funnel.constants",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      stages: requiredCodes.length,
      sharedModule: "shared/sales-funnel.constants.ts",
      note: "Unificação completa NestJS/Next.js permanece como dívida técnica.",
    },
    null,
    2,
  ),
);
