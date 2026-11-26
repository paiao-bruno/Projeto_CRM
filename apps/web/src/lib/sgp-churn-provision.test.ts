import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
});
