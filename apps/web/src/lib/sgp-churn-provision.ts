import { isSecretMask } from "./sgp-churn-lifecycle";

export const SGP_CHURN_DEFAULT_API_URL = "https://webmais.sgp.net.br";
export const SGP_CHURN_DEFAULT_APP = "vertice_crm";

/** App SGP é o nome da aplicação na API, não o e-mail da sessão do CRM. */
export function assertSgpChurnAppName(app: string) {
  const value = app.trim();
  if (!value) throw new Error("Informe o App cadastrado no SGP.");
  if (value.includes("@") || /^(admin|user)@/i.test(value)) {
    throw new Error("O App do SGP não é o e-mail do CRM. Use o nome da aplicação (exemplo vertice_crm).");
  }
  return value;
}

export type SgpChurnProvisionInput = {
  tenantSlug: string;
  apiUrl: string;
  app: string;
  tokenConfigured: boolean;
  token: string;
};

/** Lê SGP_* do processo. O token nunca deve ir para argv, logs ou respostas. */
export function parseSgpChurnProvisionEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): SgpChurnProvisionInput {
  const token = typeof env.SGP_TOKEN === "string" ? env.SGP_TOKEN.trim() : "";
  if (isSecretMask(token)) {
    throw new Error("SGP_TOKEN não pode ser a máscara. Defina o segredo real no ambiente do servidor.");
  }
  const app = String(env.SGP_APP ?? SGP_CHURN_DEFAULT_APP).trim();
  if (app) assertSgpChurnAppName(app);
  return {
    tenantSlug: String(env.SGP_CHURN_TENANT_SLUG ?? "").trim(),
    apiUrl: String(env.SGP_API_URL ?? SGP_CHURN_DEFAULT_API_URL).trim(),
    app,
    tokenConfigured: token.length > 0,
    token,
  };
}

export function missingSgpChurnProvisionFields(input: SgpChurnProvisionInput) {
  const missing: string[] = [];
  if (!input.tenantSlug) missing.push("SGP_CHURN_TENANT_SLUG");
  if (!input.apiUrl) missing.push("SGP_API_URL");
  if (!input.app) missing.push("SGP_APP");
  if (!input.tokenConfigured) missing.push("SGP_TOKEN");
  return missing;
}

export function publicSgpChurnProvision(input: SgpChurnProvisionInput) {
  return {
    tenantSlug: input.tenantSlug || null,
    apiUrl: input.apiUrl,
    app: input.app,
    tokenConfigured: input.tokenConfigured,
  };
}
