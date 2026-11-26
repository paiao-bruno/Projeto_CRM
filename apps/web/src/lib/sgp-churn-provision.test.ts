import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertSgpChurnAppName,
  missingSgpChurnProvisionFields,
  parseSgpChurnProvisionEnv,
  publicSgpChurnProvision,
  SGP_CHURN_DEFAULT_API_URL,
  SGP_CHURN_DEFAULT_APP,
} from "./sgp-churn-provision";

describe("provisionamento SGP de cancelamentos", () => {
  it("não escolhe tenant sozinho e não trata máscara como token", () => {
    const parsed = parseSgpChurnProvisionEnv({
      SGP_API_URL: SGP_CHURN_DEFAULT_API_URL,
      SGP_APP: SGP_CHURN_DEFAULT_APP,
    });
    assert.equal(parsed.tenantSlug, "");
    assert.equal(parsed.tokenConfigured, false);
    assert.deepEqual(missingSgpChurnProvisionFields(parsed), ["SGP_CHURN_TENANT_SLUG", "SGP_TOKEN"]);
    assert.throws(
      () => parseSgpChurnProvisionEnv({ SGP_TOKEN: "••••••", SGP_CHURN_TENANT_SLUG: "fibra-plus" }),
      /máscara/,
    );
  });

  it("expõe URL e App sem o segredo", () => {
    const parsed = parseSgpChurnProvisionEnv({
      SGP_CHURN_TENANT_SLUG: "fibra-plus",
      SGP_APP: "vertice_crm",
      SGP_TOKEN: "valor-que-nao-deve-aparecer-na-saida-publica",
    });
    const published = publicSgpChurnProvision(parsed);
    assert.equal(published.tokenConfigured, true);
    assert.equal(published.app, "vertice_crm");
    assert.equal(published.apiUrl, SGP_CHURN_DEFAULT_API_URL);
    assert.equal(JSON.stringify(published).includes("valor-que-nao"), false);
  });

  it("o comando inspect:sgp-churn existe e não recebe o token por argv", () => {
    const root = join(process.cwd(), "..", "..");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    assert.equal(pkg.scripts?.["inspect:sgp-churn"], "node scripts/inspect-sgp-churn.mjs");
    const inspect = readFileSync(join(root, "scripts/inspect-sgp-churn.mjs"), "utf8");
    assert.equal(existsSync(join(root, "apps/web/src/server/sgp-churn-inspect-main.ts")), true);
    assert.match(inspect, /nunca em argv/);
    assert.doesNotMatch(inspect, /process\.argv/);
  });

  it("rejeita e-mail do CRM como App SGP", () => {
    assert.equal(assertSgpChurnAppName("vertice_crm"), "vertice_crm");
    assert.throws(() => assertSgpChurnAppName("admin@ispcrm.local"), /não é o e-mail/);
    assert.throws(
      () => parseSgpChurnProvisionEnv({ SGP_APP: "admin@ispcrm.local", SGP_TOKEN: "x", SGP_CHURN_TENANT_SLUG: "fibra-plus" }),
      /não é o e-mail/,
    );
  });
});
