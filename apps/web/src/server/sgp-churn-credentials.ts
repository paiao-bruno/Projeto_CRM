import { IntegrationProvider, IntegrationStatus } from "@prisma/client";
import { isSecretMask, rankSgpChurnCandidates } from "../lib/sgp-churn-lifecycle";
import {
  assertSgpChurnAppName,
  missingSgpChurnProvisionFields,
  parseSgpChurnProvisionEnv,
  publicSgpChurnProvision,
} from "../lib/sgp-churn-provision";
import type { ServerAuthUser } from "./auth";
import { HttpError } from "./http";
import { getPrisma } from "./prisma";
import { encryptSecret } from "./secret-box";
import { assertAllowedSgpUrl, type SgpChurnCredentials } from "./sgp-churn-client";
import { decryptSgpSecrets } from "./sgp-secret-decrypt";

export const CHURN_INTEGRATION_NAME = "SGP leitura de cancelamentos";

type IntegrationRow = {
  id: string;
  name: string;
  encryptedSecrets: string | null;
  config: unknown;
  updatedAt: Date;
};

export type SgpChurnRuntime = SgpChurnCredentials & {
  integrationId: string;
  credentialVersion: number;
  apiHost: string;
};

function configOf(row: IntegrationRow) {
  return row.config && typeof row.config === "object" && !Array.isArray(row.config)
    ? (row.config as Record<string, unknown>)
    : {};
}

function credentialVersion(row: IntegrationRow) {
  const value = Number(configOf(row).credentialVersion ?? 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function apiUrlOf(row: IntegrationRow) {
  const url = configOf(row).apiUrl;
  return typeof url === "string" && url.trim() ? url.trim() : "";
}

function decryptRow(row: IntegrationRow) {
  const secrets = decryptSgpSecrets(row.encryptedSecrets);
  const apiUrl = apiUrlOf(row);
  if (!secrets || !apiUrl) return null;
  return {
    ...secrets,
    apiUrl,
    apiHost: new URL(apiUrl).host,
    integrationId: row.id,
    credentialVersion: credentialVersion(row),
    authState: String(configOf(row).sgpChurnAuth ?? ""),
    dedicated: row.name === CHURN_INTEGRATION_NAME,
    name: row.name,
    updatedAt: row.updatedAt,
  };
}

export class SgpChurnCredentialsService {
  constructor(private readonly prisma = getPrisma()) {}

  async getPublic(user: ServerAuthUser) {
    const rows = await this.prisma.integration.findMany({
      where: { tenantId: user.tenantId, provider: IntegrationProvider.SGP },
    });
    const decryptableRows = rows.filter((row) => decryptRow(row as IntegrationRow)).length;
    const runtime = await this.runtime(user.tenantId);
    const selected = runtime
      ? rows
          .map((row) => decryptRow(row as IntegrationRow))
          .find((row) => row?.integrationId === runtime.integrationId)
      : null;
    return {
      configured: Boolean(runtime),
      tokenConfigured: Boolean(runtime),
      apiHost: runtime?.apiHost ?? null,
      selectedApp: selected?.app ?? runtime?.app ?? null,
      selectedIntegrationId: runtime?.integrationId ?? null,
      selectedDedicated: Boolean(selected?.dedicated),
      source: runtime ? "server" : "none",
      storedRows: rows.length,
      decryptableRows,
      encryptionReady: Boolean(process.env.APP_ENCRYPTION_KEY?.trim() || process.env.ENCRYPTION_KEY?.trim()),
    };
  }

  async save(user: ServerAuthUser, body: Record<string, unknown>) {
    const existing = await this.findWritable(user.tenantId);
    const fallback = await this.runtime(user.tenantId);
    const previousUrl = existing ? apiUrlOf(existing as IntegrationRow) : "";
    const apiUrl = assertAllowedSgpUrl(String(body.apiUrl || previousUrl || fallback?.apiUrl || ""));
    const app = String(body.app ?? "").trim();
    const incomingToken = typeof body.token === "string" ? body.token : "";
    if (isSecretMask(incomingToken)) {
      throw new HttpError(422, "O campo Token vazio preserva o segredo já gravado. Não envie a máscara.");
    }
    const preservedDedicated =
      existing && existing.name === CHURN_INTEGRATION_NAME ? decryptSgpSecrets(existing.encryptedSecrets) : null;
    const token = incomingToken.trim() || preservedDedicated?.token || "";
    const nextApp = app || preservedDedicated?.app || "";
    if (!nextApp || !token) throw new HttpError(422, "Informe o App e o Token cadastrados no SGP.");
    try {
      assertSgpChurnAppName(nextApp);
    } catch (error) {
      throw new HttpError(422, error instanceof Error ? error.message : "App SGP inválido.");
    }
    const version = existing ? credentialVersion(existing) + 1 : 1;
    const data = {
      name: CHURN_INTEGRATION_NAME,
      provider: IntegrationProvider.SGP,
      status: IntegrationStatus.ACTIVE,
      config: {
        apiUrl,
        purpose: "churn_read_only",
        credentialVersion: version,
        sgpChurnAuth: null,
      },
      encryptedSecrets: encryptSecret(JSON.stringify({ app: nextApp, token })),
      lastError: null,
    };
    if (existing && existing.name === CHURN_INTEGRATION_NAME) {
      await this.prisma.integration.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.integration.create({ data: { ...data, tenantId: user.tenantId } });
    }
    return this.getPublic(user);
  }

  async markAuth(tenantId: string, integrationId: string, ok: boolean, message?: string) {
    const row = await this.prisma.integration.findFirst({
      where: { id: integrationId, tenantId, provider: IntegrationProvider.SGP },
    });
    if (!row) return;
    const config = { ...configOf(row as IntegrationRow), sgpChurnAuth: ok ? "ok" : "denied" };
    await this.prisma.integration.update({
      where: { id: row.id },
      data: { config, lastError: ok ? null : message ?? "Autenticação recusada pelo SGP." },
    });
  }

  async runtime(tenantId: string): Promise<SgpChurnRuntime | null> {
    const rows = await this.candidates(tenantId);
    const validated = rows.find((row) => row.authState === "ok");
    const chosen = validated ?? rows[0];
    if (!chosen) return null;
    return {
      apiUrl: chosen.apiUrl,
      app: chosen.app,
      token: chosen.token,
      integrationId: chosen.integrationId,
      credentialVersion: chosen.credentialVersion,
      apiHost: chosen.apiHost,
    };
  }

  async runtimesForAuthFallback(tenantId: string) {
    return this.candidates(tenantId);
  }

  async provisionFromServerEnv(env: NodeJS.ProcessEnv = process.env) {
    const parsed = parseSgpChurnProvisionEnv(env as Record<string, string | undefined>);
    const missing = missingSgpChurnProvisionFields(parsed);
    if (missing.includes("SGP_CHURN_TENANT_SLUG")) {
      const orgs = await this.prisma.tenant.findMany({ select: { slug: true }, orderBy: { slug: "asc" } });
      const listed = orgs.length ? ` Organizações no banco: ${orgs.map((row) => row.slug).join(", ")}.` : " Nenhuma organização no banco.";
      throw new HttpError(422, `Informe SGP_CHURN_TENANT_SLUG; a leitura SGP não usa o primeiro tenant.${listed}`);
    }
    if (missing.length) {
      throw new HttpError(422, `Provisionamento incompleto: ${missing.join(", ")}.`);
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: parsed.tenantSlug },
      select: { id: true, slug: true, name: true },
    });
    if (!tenant) {
      throw new HttpError(404, "Organização não encontrada para SGP_CHURN_TENANT_SLUG.");
    }
    const member = await this.prisma.tenantMember.findFirst({
      where: {
        tenantId: tenant.id,
        status: "ACTIVE",
        role: { permissions: { some: { permission: { code: "crm.manage" } } } },
      },
      include: { user: true, role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!member?.user) {
      throw new HttpError(403, "Nenhum membro ativo com crm.manage neste tenant.");
    }
    const user: ServerAuthUser = {
      sub: member.user.id,
      email: member.user.email,
      name: member.user.name,
      tenantId: tenant.id,
      tenantName: tenant.name,
      memberId: member.id,
      role: member.role?.name ?? "Administrador",
      permissions: member.role?.permissions.map((item) => item.permission.code) ?? ["crm.manage"],
    };
    const saved = await this.save(user, { apiUrl: parsed.apiUrl, app: parsed.app, token: parsed.token });
    return {
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      ...saved,
      provision: publicSgpChurnProvision(parsed),
    };
  }

  async listConfiguredTenantIds() {
    const rows = await this.prisma.integration.findMany({
      where: { provider: IntegrationProvider.SGP },
      select: { tenantId: true },
      distinct: ["tenantId"],
    });
    return rows.map((row) => row.tenantId);
  }

  private async candidates(tenantId: string) {
    const rows = await this.prisma.integration.findMany({
      where: { tenantId, provider: IntegrationProvider.SGP },
      orderBy: { updatedAt: "desc" },
    });
    const decrypted = rankSgpChurnCandidates(
      rows
        .map((row) => decryptRow(row as IntegrationRow))
        .filter((row): row is NonNullable<typeof row> => Boolean(row)),
    );
    const usable = decrypted.filter((row) => row.authState !== "denied");
    return usable.length ? usable : decrypted;
  }

  private findWritable(tenantId: string) {
    return this.prisma.integration.findFirst({
      where: { tenantId, provider: IntegrationProvider.SGP, name: CHURN_INTEGRATION_NAME },
    });
  }
}

let singleton: SgpChurnCredentialsService | null = null;
export function getSgpChurnCredentialsService() {
  singleton ??= new SgpChurnCredentialsService();
  return singleton;
}
