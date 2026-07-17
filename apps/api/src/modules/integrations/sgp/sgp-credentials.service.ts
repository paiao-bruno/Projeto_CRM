import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  HealthStatus,
  IntegrationProvider,
  IntegrationStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { EncryptionService } from "../crypto/encryption.service";
import { CreateSgpCredentialsDto } from "../dto/create-sgp-credentials.dto";
import { UpdateSgpCredentialsDto } from "../dto/update-sgp-credentials.dto";
import {
  SgpCredentialsPublicView,
  SgpIntegrationConfig,
  SgpIntegrationSecrets,
  SgpRuntimeCredentials,
} from "./types/sgp-credentials.types";
import {
  mergeSgpSyncState,
  readSgpSyncState,
  SgpSyncState,
} from "./sgp-sync.utils";

const DEFAULT_SGP_NAME = "SGP";

@Injectable()
export class SgpCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async list(tenantId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: {
        tenantId,
        provider: IntegrationProvider.SGP,
      },
      orderBy: { createdAt: "desc" },
    });

    return integrations.map((integration) => this.toPublicView(integration));
  }

  async get(tenantId: string, id: string) {
    const integration = await this.findIntegrationOrThrow(tenantId, id);
    return this.toPublicView(integration);
  }

  async create(tenantId: string, dto: CreateSgpCredentialsDto) {
    const name = dto.name?.trim() || DEFAULT_SGP_NAME;

    const existing = await this.prisma.integration.findUnique({
      where: {
        tenantId_provider_name: {
          tenantId,
          provider: IntegrationProvider.SGP,
          name,
        },
      },
    });

    if (existing) {
      throw new BadRequestException(
        `Já existe uma integração SGP com o nome "${name}" para esta empresa.`,
      );
    }

    const integration = await this.prisma.integration.create({
      data: {
        tenantId,
        provider: IntegrationProvider.SGP,
        name,
        status: IntegrationStatus.ACTIVE,
        healthStatus: HealthStatus.UNKNOWN,
        config: this.buildConfig(dto),
        encryptedSecrets: this.encryption.encryptJson({
          app: dto.app.trim(),
          token: dto.token.trim(),
        }),
      },
    });

    return this.toPublicView(integration);
  }

  async update(tenantId: string, id: string, dto: UpdateSgpCredentialsDto) {
    const integration = await this.findIntegrationOrThrow(tenantId, id);
    const currentConfig = this.readConfig(integration.config);
    const currentSecrets = this.readSecrets(integration.encryptedSecrets);

    const nextName = dto.name?.trim();
    if (nextName && nextName !== integration.name) {
      const duplicate = await this.prisma.integration.findUnique({
        where: {
          tenantId_provider_name: {
            tenantId,
            provider: IntegrationProvider.SGP,
            name: nextName,
          },
        },
      });

      if (duplicate) {
        throw new BadRequestException(
          `Já existe uma integração SGP com o nome "${nextName}" para esta empresa.`,
        );
      }
    }

    const updated = await this.prisma.integration.update({
      where: { id: integration.id },
      data: {
        name: nextName ?? integration.name,
        status: dto.status ?? integration.status,
        config: this.buildConfig({
          apiUrl: dto.apiUrl ?? currentConfig.apiUrl,
          apiPort: dto.apiPort ?? currentConfig.apiPort,
          timeoutMs: dto.timeoutMs ?? currentConfig.timeoutMs,
        }),
        encryptedSecrets:
          dto.app || dto.token
            ? this.encryption.encryptJson({
                app: (dto.app ?? currentSecrets.app).trim(),
                token: (dto.token ?? currentSecrets.token).trim(),
              })
            : integration.encryptedSecrets,
      },
    });

    return this.toPublicView(updated);
  }

  async remove(tenantId: string, id: string) {
    const integration = await this.findIntegrationOrThrow(tenantId, id);

    await this.prisma.integration.delete({
      where: { id: integration.id },
    });

    return { deleted: true, id: integration.id };
  }

  async resolveActiveCredentials(tenantId: string): Promise<SgpRuntimeCredentials> {
    const integration = await this.prisma.integration.findFirst({
      where: {
        tenantId,
        provider: IntegrationProvider.SGP,
        status: {
          in: [IntegrationStatus.ACTIVE, IntegrationStatus.DEGRADED, IntegrationStatus.CONNECTING],
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });

    if (!integration) {
      throw new BadRequestException(
        "Nenhuma credencial SGP ativa foi configurada para esta empresa.",
      );
    }

    return this.toRuntimeCredentials(integration);
  }

  async resolveCredentialsById(tenantId: string, id: string): Promise<SgpRuntimeCredentials> {
    const integration = await this.findIntegrationOrThrow(tenantId, id);
    return this.toRuntimeCredentials(integration);
  }

  async markConnectionResult(
    tenantId: string,
    id: string,
    input: { success: boolean; errorMessage?: string },
  ) {
    await this.prisma.integration.updateMany({
      where: {
        id,
        tenantId,
        provider: IntegrationProvider.SGP,
      },
      data: {
        healthStatus: input.success ? HealthStatus.HEALTHY : HealthStatus.DOWN,
        lastConnectedAt: input.success ? new Date() : undefined,
        lastError: input.success ? null : input.errorMessage,
        status: input.success ? IntegrationStatus.ACTIVE : IntegrationStatus.ERROR,
      },
    });
  }

  async getSyncState(tenantId: string, credentialId?: string): Promise<SgpSyncState> {
    const integration = credentialId
      ? await this.findIntegrationOrThrow(tenantId, credentialId)
      : await this.findActiveIntegration(tenantId);

    return readSgpSyncState(integration.config);
  }

  async updateSyncState(
    tenantId: string,
    credentialId: string | undefined,
    syncState: SgpSyncState,
  ) {
    const integration = credentialId
      ? await this.findIntegrationOrThrow(tenantId, credentialId)
      : await this.findActiveIntegration(tenantId);

    await this.prisma.integration.update({
      where: { id: integration.id },
      data: {
        config: mergeSgpSyncState(integration.config, syncState),
      },
    });
  }

  async resolveIntegrationId(tenantId: string, credentialId?: string) {
    const integration = credentialId
      ? await this.findIntegrationOrThrow(tenantId, credentialId)
      : await this.findActiveIntegration(tenantId);

    return integration.id;
  }

  private async findActiveIntegration(tenantId: string) {
    const integration = await this.prisma.integration.findFirst({
      where: {
        tenantId,
        provider: IntegrationProvider.SGP,
        status: {
          in: [IntegrationStatus.ACTIVE, IntegrationStatus.DEGRADED, IntegrationStatus.CONNECTING],
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });

    if (!integration) {
      throw new BadRequestException(
        "Nenhuma credencial SGP ativa foi configurada para esta empresa.",
      );
    }

    return integration;
  }

  private async findIntegrationOrThrow(tenantId: string, id: string) {
    const integration = await this.prisma.integration.findFirst({
      where: {
        id,
        tenantId,
        provider: IntegrationProvider.SGP,
      },
    });

    if (!integration) {
      throw new NotFoundException("Credencial SGP não encontrada.");
    }

    return integration;
  }

  private toRuntimeCredentials(integration: {
    config: Prisma.JsonValue | null;
    encryptedSecrets: string | null;
  }): SgpRuntimeCredentials {
    const config = this.readConfig(integration.config);
    const secrets = this.readSecrets(integration.encryptedSecrets);

    return {
      ...config,
      ...secrets,
    };
  }

  private readConfig(config: Prisma.JsonValue | null): SgpIntegrationConfig {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new BadRequestException("Configuração SGP inválida.");
    }

    const record = config as Record<string, unknown>;
    const apiUrl = typeof record.apiUrl === "string" ? record.apiUrl.trim() : "";

    if (!apiUrl) {
      throw new BadRequestException("A URL da API SGP não está configurada.");
    }

    return {
      apiUrl,
      apiPort:
        typeof record.apiPort === "string" && record.apiPort.trim()
          ? record.apiPort.trim()
          : undefined,
      timeoutMs:
        typeof record.timeoutMs === "number" && Number.isFinite(record.timeoutMs)
          ? record.timeoutMs
          : undefined,
    };
  }

  private readSecrets(encryptedSecrets: string | null): SgpIntegrationSecrets {
    if (!encryptedSecrets) {
      throw new BadRequestException("Credenciais SGP não configuradas.");
    }

    const secrets = this.encryption.decryptJson<SgpIntegrationSecrets>(encryptedSecrets);
    const app = typeof secrets.app === "string" ? secrets.app.trim() : "";
    const token = typeof secrets.token === "string" ? secrets.token.trim() : "";

    if (!app || !token) {
      throw new BadRequestException("Credenciais SGP incompletas.");
    }

    return { app, token };
  }

  private buildConfig(input: {
    apiUrl: string;
    apiPort?: string;
    timeoutMs?: number;
  }): Prisma.InputJsonObject {
    return {
      apiUrl: input.apiUrl.trim(),
      ...(input.apiPort?.trim() ? { apiPort: input.apiPort.trim() } : {}),
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    };
  }

  private toPublicView(integration: {
    id: string;
    tenantId: string;
    name: string;
    status: string;
    healthStatus: string;
    config: Prisma.JsonValue | null;
    encryptedSecrets: string | null;
    lastConnectedAt: Date | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): SgpCredentialsPublicView {
    const config = this.readConfig(integration.config);
    const secrets = integration.encryptedSecrets
      ? this.readSecrets(integration.encryptedSecrets)
      : null;

    return {
      id: integration.id,
      tenantId: integration.tenantId,
      name: integration.name,
      status: integration.status,
      healthStatus: integration.healthStatus,
      apiUrl: config.apiUrl,
      apiPort: config.apiPort ?? null,
      timeoutMs: config.timeoutMs ?? null,
      app: secrets?.app ?? "",
      tokenConfigured: Boolean(secrets?.token),
      tokenPreview: secrets?.token ? this.maskSecret(secrets.token) : null,
      lastConnectedAt: integration.lastConnectedAt,
      lastError: integration.lastError,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    };
  }

  private maskSecret(value: string) {
    if (value.length <= 4) return "****";
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }
}
