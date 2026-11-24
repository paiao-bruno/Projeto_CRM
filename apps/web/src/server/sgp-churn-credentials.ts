import { IntegrationProvider, IntegrationStatus } from "@prisma/client";
import type { ServerAuthUser } from "./auth";
import { HttpError } from "./http";
import { getPrisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./secret-box";
import { assertAllowedSgpUrl, type SgpChurnCredentials } from "./sgp-churn-client";

const INTEGRATION_NAME = "SGP leitura de cancelamentos";

function parseSecrets(encrypted: string | null): { app: string; token: string } | null {
  if (!encrypted) return null;
  try {
    const parsed = JSON.parse(decryptSecret(encrypted)) as { app?: string; token?: string };
    if (!parsed.app || !parsed.token) return null;
    return { app: parsed.app, token: parsed.token };
  } catch {
    return null;
  }
}

export class SgpChurnCredentialsService {
  constructor(private readonly prisma = getPrisma()) {}

  async getPublic(user: ServerAuthUser) {
    const row = await this.find(user.tenantId);
    const config = (row?.config as { apiUrl?: string } | null) ?? {};
    return {
      configured: Boolean(row && parseSecrets(row.encryptedSecrets) && config.apiUrl),
      apiHost: config.apiUrl ? new URL(config.apiUrl).host : null,
      status: row?.status ?? null,
    };
  }

  async save(user: ServerAuthUser, body: Record<string, unknown>) {
    const apiUrl = assertAllowedSgpUrl(String(body.apiUrl ?? ""));
    const app = String(body.app ?? "").trim();
    const token = String(body.token ?? "").trim();
    if (!app || !token) throw new HttpError(422, "Informe app e token do SGP.");
    const existing = await this.find(user.tenantId);
    const data = {
      name: INTEGRATION_NAME,
      provider: IntegrationProvider.SGP,
      status: IntegrationStatus.ACTIVE,
      config: { apiUrl, purpose: "churn_read_only" },
      encryptedSecrets: encryptSecret(JSON.stringify({ app, token })),
      lastError: null,
    };
    if (existing) {
      await this.prisma.integration.update({ where: { id: existing.id }, data });
      return this.getPublic(user);
    }
    await this.prisma.integration.create({
      data: { ...data, tenantId: user.tenantId },
    });
    return this.getPublic(user);
  }

  async runtime(tenantId: string): Promise<(SgpChurnCredentials & { integrationId: string }) | null> {
    const row = await this.find(tenantId);
    if (!row) return null;
    const secrets = parseSecrets(row.encryptedSecrets);
    const apiUrl = (row.config as { apiUrl?: string } | null)?.apiUrl;
    if (!secrets || !apiUrl) return null;
    return { apiUrl, app: secrets.app, token: secrets.token, integrationId: row.id };
  }

  private find(tenantId: string) {
    return this.prisma.integration.findFirst({
      where: { tenantId, provider: IntegrationProvider.SGP, name: INTEGRATION_NAME },
    });
  }
}

let singleton: SgpChurnCredentialsService | null = null;
export function getSgpChurnCredentialsService() {
  singleton ??= new SgpChurnCredentialsService();
  return singleton;
}
