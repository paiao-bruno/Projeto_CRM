import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { safeJsonStringify } from "../../security/utils/redact-sensitive.util";
import { chunkArray, DEFAULT_BATCH_SIZE, RECONCILE_BATCH_SIZE } from "../../common/batch.util";
import {
  ContractStatus,
  CustomerStatus,
  IntegrationSyncEntity,
  IntegrationSyncStatus,
  InvoiceStatus,
  Prisma,
} from "@prisma/client";
import {
  CustomersService,
  ExternalCustomerInput,
} from "../customers/customers.service";
import { AuthUser } from "../auth/types/auth-user";
import { PrismaService } from "../database/prisma.service";
import { CreateSgpCredentialsDto } from "./dto/create-sgp-credentials.dto";
import { TestSgpCredentialsDto, UpdateSgpCredentialsDto } from "./dto/update-sgp-credentials.dto";
import { UpdateSgpAutoSyncDto } from "./dto/update-sgp-auto-sync.dto";
import { ListSgpSyncHistoryDto } from "./dto/list-sgp-sync-history.dto";
import { SgpCredentialsService } from "./sgp/sgp-credentials.service";
import { computeNextRunAt } from "./sgp/sgp-auto-sync.config";
import { SgpSyncHistoryService } from "./sgp/sgp-sync-history.service";
import { SgpClientService } from "./sgp/sgp-client.service";
import { SgpRuntimeCredentials } from "./sgp/types/sgp-credentials.types";
import { SgpDiscoveryRequest } from "./sgp/types/sgp-client.types";
import {
  buildSgpIncrementalFilters,
  hashContractPayload,
  hashInvoicePayload,
  isChangedSince,
  readSgpContentHash,
  SgpIncrementalContext,
  SgpSyncMode,
  withSgpContentHash,
} from "./sgp/sgp-sync.utils";
import {
  createSgpSeenExternalIds,
  isSgpDeletedRecord,
  isSgpManagedMetadata,
  SgpSeenExternalIds,
  withSgpDeletionMetadata,
  withSgpRestoredMetadata,
} from "./sgp/sgp-deletion.sync";

type SgpCustomerMapping = {
  customer: ExternalCustomerInput;
  contracts: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
};

type SyncCounters = {
  processed: number;
  created: number;
  updated: number;
  unchanged: number;
  contractsCreated: number;
  contractsUpdated: number;
  contractsUnchanged: number;
  invoicesCreated: number;
  invoicesUpdated: number;
  invoicesUnchanged: number;
  customersDeleted: number;
  contractsDeleted: number;
  invoicesDeleted: number;
  ignored: number;
  errors: Array<{ index: number; message: string }>;
  syncMode: SgpSyncMode;
  watermark?: string | null;
};

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  private readonly runningCustomerSyncs = new Set<string>();
  private syncLogBuffer: Array<{
    tenantId: string;
    runId: string;
    entity: IntegrationSyncEntity;
    action: string;
    status: IntegrationSyncStatus;
    externalId?: string;
    message?: string;
    metadata?: Prisma.InputJsonValue;
  }> = [];

  constructor(
    private readonly sgpClient: SgpClientService,
    private readonly sgpCredentials: SgpCredentialsService,
    private readonly customersService: CustomersService,
    private readonly prisma: PrismaService,
    private readonly syncHistory: SgpSyncHistoryService,
  ) {}

  listSgpCredentials(tenantId: string) {
    return this.sgpCredentials.list(tenantId);
  }

  getSgpCredentials(tenantId: string, id: string) {
    return this.sgpCredentials.get(tenantId, id);
  }

  createSgpCredentials(tenantId: string, dto: CreateSgpCredentialsDto) {
    return this.sgpCredentials.create(tenantId, dto);
  }

  updateSgpCredentials(tenantId: string, id: string, dto: UpdateSgpCredentialsDto) {
    return this.sgpCredentials.update(tenantId, id, dto);
  }

  removeSgpCredentials(tenantId: string, id: string) {
    return this.sgpCredentials.remove(tenantId, id);
  }

  async testSgpAuth(user: AuthUser, request: SgpDiscoveryRequest = {}, credentialId?: string) {
    const credentials = await this.resolveSgpCredentials(user.tenantId, credentialId, request);

    try {
      const response = await this.sgpClient.testAuth(
        credentials,
        request.payload,
        request.endpoint,
      );

      if (credentialId) {
        await this.sgpCredentials.markConnectionResult(user.tenantId, credentialId, {
          success: true,
        });
      }

      return response.body;
    } catch (error) {
      if (credentialId) {
        await this.sgpCredentials.markConnectionResult(user.tenantId, credentialId, {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }

      throw error;
    }
  }

  async testSgpCredentials(user: AuthUser, dto: TestSgpCredentialsDto, credentialId?: string) {
    const runtimeCredentials = credentialId
      ? await this.buildTestCredentials(user.tenantId, credentialId, dto)
      : this.buildInlineTestCredentials(dto);

    try {
      const response = await this.sgpClient.testAuth(
        runtimeCredentials,
        {},
        dto.endpoint,
      );

      if (credentialId) {
        await this.sgpCredentials.markConnectionResult(user.tenantId, credentialId, {
          success: true,
        });
      }

      return {
        ok: true,
        body: response.body,
      };
    } catch (error) {
      if (credentialId) {
        await this.sgpCredentials.markConnectionResult(user.tenantId, credentialId, {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }

      throw error;
    }
  }

  async discoverSgpCustomers(user: AuthUser, request: SgpDiscoveryRequest = {}) {
    const credentials = await this.resolveSgpCredentials(user.tenantId, request.credentialId, request);
    const response = await this.sgpClient.discoverCustomers(
      credentials,
      this.buildDiscoveryPayload(request),
    );
    this.assertCustomerDiscoveryResponse(response.body, request.endpoint);
    const rawCustomers = this.extractCustomers(response.body);
    const customers = rawCustomers.map((rawCustomer) => this.mapSgpCustomer(rawCustomer));

    return {
      processed: customers.length,
      pagination: this.extractPaginationFromBody(response.body),
      customers: customers.map((item) => ({
        customer: item.customer,
        contractsCount: item.contracts.length,
        invoicesCount: item.invoices.length,
      })),
    };
  }

  async syncSgpCustomers(user: AuthUser, request: SgpDiscoveryRequest = {}) {
    const lockKey = user.tenantId;

    if (this.runningCustomerSyncs.has(lockKey)) {
      const skippedRun = await this.prisma.integrationSyncRun.create({
        data: {
          tenantId: user.tenantId,
          triggeredById: user.memberId,
          integrationId: request.credentialId,
          operation: "sgp.sync-customers",
          status: IntegrationSyncStatus.SKIPPED,
          trigger: "manual",
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 0,
          metadata: {
            reason: "sync_already_running",
          },
        },
      });
      this.logger.warn(
        safeJsonStringify({
          event: "sgp.sync-customers.skipped",
          tenantId: user.tenantId,
          runId: skippedRun.id,
          reason: "sync_already_running",
        }),
      );

      return {
        status: "already_running",
        runId: skippedRun.id,
        message: "Uma sincronização de clientes SGP já está em execução.",
      };
    }

    this.runningCustomerSyncs.add(lockKey);
    const syncMode = this.resolveSyncMode(request);
    const run = await this.prisma.integrationSyncRun.create({
      data: {
        tenantId: user.tenantId,
        triggeredById: user.memberId,
        integrationId: request.credentialId,
        operation: "sgp.sync-customers",
        status: IntegrationSyncStatus.RUNNING,
        syncMode,
        trigger: "manual",
        cursor: this.toJsonValue(request.pagination),
        metadata: this.toJsonValue({
          syncMode,
          credentialId: request.credentialId,
          trigger: "manual",
        }),
      },
    });

    void this.processSgpCustomers(user, request, run.id)
      .then((result) => {
        this.logger.log(
          safeJsonStringify({
            event: "sgp.sync-customers.finished",
            tenantId: user.tenantId,
            runId: run.id,
            ...result,
          }),
        );
      })
      .catch((error) => {
        this.logger.error(
          safeJsonStringify({
            event: "sgp.sync-customers.failed",
            tenantId: user.tenantId,
            runId: run.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      })
      .finally(() => {
        this.runningCustomerSyncs.delete(lockKey);
      });

    return {
      status: "started",
      runId: run.id,
      message:
        syncMode === "full"
          ? "Sincronização completa de clientes SGP iniciada em background."
          : "Sincronização incremental de clientes SGP iniciada em background.",
    };
  }

  async getSgpAutoSyncConfig(tenantId: string, credentialId?: string) {
    return this.sgpCredentials.getAutoSyncConfig(tenantId, credentialId);
  }

  updateSgpAutoSyncConfig(
    tenantId: string,
    dto: UpdateSgpAutoSyncDto,
    credentialId?: string,
  ) {
    return this.sgpCredentials.updateAutoSyncConfig(tenantId, dto, credentialId);
  }

  async recoverStaleSyncRuns(maxAgeMs: number) {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const recovered = await this.prisma.integrationSyncRun.updateMany({
      where: {
        operation: "sgp.sync-customers",
        status: IntegrationSyncStatus.RUNNING,
        startedAt: { lt: cutoff },
      },
      data: {
        status: IntegrationSyncStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: "Sincronização interrompida por timeout ou reinício do serviço.",
      },
    });

    if (recovered.count > 0) {
      this.logger.warn(
        safeJsonStringify({
          event: "sgp.sync.recovered-stale-runs",
          count: recovered.count,
          maxAgeMs,
        }),
      );
    }

    return recovered.count;
  }

  async runAutomatedSgpSync(input: {
    tenantId: string;
    integrationId: string;
    trigger: "cron" | "interval" | "manual";
    triggeredById?: string;
    retryAttempts: number;
    retryDelayMs: number;
    timeoutMs: number;
  }) {
    const lockKey = input.tenantId;

    if (this.runningCustomerSyncs.has(lockKey)) {
      await this.sgpCredentials.updateAutoSyncRuntime(input.tenantId, input.integrationId, {
        lastRunAt: new Date().toISOString(),
        lastStatus: "skipped",
        lastError: "sync_already_running",
      });

      return {
        status: "already_running" as const,
      };
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= input.retryAttempts; attempt += 1) {
      try {
        const result = await this.withTimeout(
          this.executeAutomatedSync(input),
          input.timeoutMs,
          "Tempo limite da sincronização automática SGP excedido.",
        );

        const config = await this.sgpCredentials.getAutoSyncConfig(
          input.tenantId,
          input.integrationId,
        );

        await this.sgpCredentials.updateAutoSyncRuntime(input.tenantId, input.integrationId, {
          lastRunAt: new Date().toISOString(),
          lastStatus: "completed",
          lastError: null,
          nextRunAt: computeNextRunAt(config),
        });

        this.logger.log(
          safeJsonStringify({
            event: "sgp.auto-sync.completed",
            tenantId: input.tenantId,
            integrationId: input.integrationId,
            trigger: input.trigger,
            attempt,
            runId: result.runId,
          }),
        );

        return {
          status: "completed" as const,
          runId: result.runId,
          result: result.counters,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (lastError.message.includes("Tempo limite")) {
          this.runningCustomerSyncs.delete(lockKey);
          await this.prisma.integrationSyncRun.updateMany({
            where: {
              tenantId: input.tenantId,
              operation: "sgp.sync-customers",
              status: IntegrationSyncStatus.RUNNING,
            },
            data: {
              status: IntegrationSyncStatus.FAILED,
              finishedAt: new Date(),
              errorMessage: lastError.message,
              stackTrace: lastError.stack,
            },
          });
        }

        this.logger.warn(
          safeJsonStringify({
            event: "sgp.auto-sync.retry",
            tenantId: input.tenantId,
            integrationId: input.integrationId,
            trigger: input.trigger,
            attempt,
            maxAttempts: input.retryAttempts,
            error: lastError.message,
          }),
        );

        if (attempt < input.retryAttempts) {
          await this.sleep(input.retryDelayMs);
        }
      }
    }

    await this.sgpCredentials.updateAutoSyncRuntime(input.tenantId, input.integrationId, {
      lastRunAt: new Date().toISOString(),
      lastStatus: "failed",
      lastError: lastError?.message ?? "Erro desconhecido.",
    });

    throw lastError ?? new Error("Falha na sincronização automática SGP.");
  }

  private buildSystemUser(tenantId: string): AuthUser {
    return {
      sub: "system-scheduler",
      email: "scheduler@system.local",
      name: "SGP Scheduler",
      tenantId,
      tenantName: tenantId,
      memberId: "system-scheduler",
      role: "System",
    };
  }

  private async executeAutomatedSync(input: {
    tenantId: string;
    integrationId: string;
    trigger: "cron" | "interval" | "manual";
    triggeredById?: string;
  }) {
    const lockKey = input.tenantId;

    if (this.runningCustomerSyncs.has(lockKey)) {
      throw new Error("Uma sincronização SGP já está em execução para este tenant.");
    }

    this.runningCustomerSyncs.add(lockKey);

    const run = await this.prisma.integrationSyncRun.create({
      data: {
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        triggeredById: input.triggeredById,
        operation: "sgp.sync-customers",
        status: IntegrationSyncStatus.RUNNING,
        syncMode: "incremental",
        trigger: input.trigger,
        metadata: this.toJsonValue({
          syncMode: "incremental",
          trigger: input.trigger,
          automated: true,
          integrationId: input.integrationId,
        }),
      },
    });

    await this.sgpCredentials.updateAutoSyncRuntime(input.tenantId, input.integrationId, {
      lastRunAt: new Date().toISOString(),
      lastStatus: "running",
      lastError: null,
    });

    try {
      const counters = await this.processSgpCustomers(
        this.buildSystemUser(input.tenantId),
        {
          credentialId: input.integrationId,
        },
        run.id,
      );

      return { runId: run.id, counters };
    } finally {
      this.runningCustomerSyncs.delete(lockKey);
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
    let timeoutHandle: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async triggerManualAutoSync(user: AuthUser) {
    const integration = await this.sgpCredentials.getAutoSyncIntegration(user.tenantId);
    const config = await this.sgpCredentials.getAutoSyncConfig(user.tenantId, integration.id);

    return this.runAutomatedSgpSync({
      tenantId: user.tenantId,
      integrationId: integration.id,
      trigger: "manual",
      triggeredById: user.memberId,
      retryAttempts: config.retryAttempts,
      retryDelayMs: config.retryDelayMs,
      timeoutMs: config.timeoutMs,
    });
  }

  getSgpSyncStatus(tenantId: string) {
    return this.syncHistory.getLatest(tenantId);
  }

  listSgpSyncRuns(tenantId: string, query: ListSgpSyncHistoryDto = {}) {
    return this.syncHistory.list(tenantId, query);
  }

  getSgpSyncRun(tenantId: string, id: string) {
    return this.syncHistory.getById(tenantId, id);
  }

  private async processSgpCustomers(
    user: AuthUser,
    request: SgpDiscoveryRequest = {},
    runId?: string,
  ) {
    const credentials = await this.resolveSgpCredentials(user.tenantId, request.credentialId, request);
    const incrementalContext = await this.resolveIncrementalContext(
      user.tenantId,
      request,
    );
    const startedAt = Date.now();
    const result: SyncCounters = {
      processed: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      contractsCreated: 0,
      contractsUpdated: 0,
      contractsUnchanged: 0,
      invoicesCreated: 0,
      invoicesUpdated: 0,
      invoicesUnchanged: 0,
      customersDeleted: 0,
      contractsDeleted: 0,
      invoicesDeleted: 0,
      ignored: 0,
      errors: [] as Array<{ index: number; message: string }>,
      syncMode: incrementalContext.mode,
      watermark: incrementalContext.since?.toISOString() ?? null,
    };
    let pagination = request.pagination;
    const seenExternalIds = createSgpSeenExternalIds();
    this.syncLogBuffer = [];

    try {
      while (true) {
        const response = await this.sgpClient.discoverCustomers(
          credentials,
          this.buildSyncPayload(request, incrementalContext, pagination),
        );
        this.assertCustomerDiscoveryResponse(response.body, request.endpoint);
        const responseBody = this.isRecord(response.body) ? response.body : {};
        this.trackRootExternalIds(responseBody, seenExternalIds);
        const rawCustomers = this.extractCustomers(response.body);
        result.processed += rawCustomers.length;

        for (const [index, rawCustomer] of rawCustomers.entries()) {
          const globalIndex = result.processed - rawCustomers.length + index;
          try {
            const mapped = this.mapSgpCustomer(rawCustomer);
            this.trackMappedExternalIds(mapped, seenExternalIds);

            if (!mapped.customer.externalId && !mapped.customer.document) {
              result.ignored += 1;
              const message =
                "Cliente ignorado porque não possui CPF/CNPJ nem identificador externo.";
              result.errors.push({ index: globalIndex, message });
              if (runId) {
                await this.createSyncLog({
                  tenantId: user.tenantId,
                  runId,
                  entity: IntegrationSyncEntity.CUSTOMER,
                  action: "ignored",
                  status: IntegrationSyncStatus.PARTIAL,
                  message,
                });
              }
              continue;
            }

            if (mapped.customer.externalId && isSgpDeletedRecord(rawCustomer)) {
              const deleted = await this.softDeleteSgpCustomer(
                user.tenantId,
                mapped.customer.externalId,
                runId,
              );
              if (deleted) {
                result.customersDeleted += 1;
              }
              continue;
            }

            const skipCustomerUpsert =
              incrementalContext.mode === "incremental" &&
              incrementalContext.since &&
              !isChangedSince(rawCustomer, incrementalContext.since);

            let customerRecord;
            if (!skipCustomerUpsert) {
              const upsert = await this.customersService.upsertFromExternalSource(
                user.tenantId,
                user.memberId,
                mapped.customer,
              );
              customerRecord = upsert.customer;

              if (upsert.operation === "created") {
                result.created += 1;
              } else if (upsert.operation === "updated") {
                result.updated += 1;
              } else {
                result.unchanged += 1;
              }
              if (runId) {
                await this.createSyncLog({
                  tenantId: user.tenantId,
                  runId,
                  entity: IntegrationSyncEntity.CUSTOMER,
                  externalId: mapped.customer.externalId ?? mapped.customer.document,
                  action: upsert.operation,
                  status:
                    upsert.operation === "unchanged"
                      ? IntegrationSyncStatus.SKIPPED
                      : IntegrationSyncStatus.COMPLETED,
                  metadata: this.toJsonValue({ customerId: upsert.customer.id }),
                });
              }
            } else {
              customerRecord = await this.findSgpCustomerRecord(
                user.tenantId,
                mapped.customer.externalId,
                mapped.customer.document,
              );

              if (!customerRecord) {
                result.ignored += 1;
                continue;
              }

              result.unchanged += 1;
              if (runId) {
                await this.createSyncLog({
                  tenantId: user.tenantId,
                  runId,
                  entity: IntegrationSyncEntity.CUSTOMER,
                  externalId: mapped.customer.externalId ?? mapped.customer.document,
                  action: "unchanged",
                  status: IntegrationSyncStatus.SKIPPED,
                  message: "Registro inalterado desde a última sincronização.",
                });
              }
            }

            const seenCustomerContracts = this.collectContractExternalIds(mapped.contracts);
            const seenCustomerInvoices = this.collectInvoiceExternalIds(mapped.invoices);

            const contractUpserts = await this.upsertContracts(
              user.tenantId,
              customerRecord.id,
              mapped.contracts,
              runId,
              incrementalContext,
            );
            result.contractsCreated += contractUpserts.created;
            result.contractsUpdated += contractUpserts.updated;
            result.contractsUnchanged += contractUpserts.unchanged;
            result.contractsDeleted += contractUpserts.deleted;

            const invoiceUpserts = await this.upsertInvoices(
              user.tenantId,
              customerRecord.id,
              mapped.invoices,
              runId,
              incrementalContext,
            );
            result.invoicesCreated += invoiceUpserts.created;
            result.invoicesUpdated += invoiceUpserts.updated;
            result.invoicesUnchanged += invoiceUpserts.unchanged;
            result.invoicesDeleted += invoiceUpserts.deleted;

            result.contractsDeleted += await this.reconcileMissingSgpContractsForCustomer(
              user.tenantId,
              customerRecord.id,
              seenCustomerContracts,
              runId,
            );
            result.invoicesDeleted += await this.reconcileMissingSgpInvoicesForCustomer(
              user.tenantId,
              customerRecord.id,
              seenCustomerInvoices,
              runId,
            );
          } catch (error) {
            result.ignored += 1;
            const message = error instanceof Error ? error.message : "Erro inesperado.";
            result.errors.push({ index: globalIndex, message });
            if (runId) {
              await this.createSyncLog({
                tenantId: user.tenantId,
                runId,
                entity: IntegrationSyncEntity.CUSTOMER,
                action: "error",
                status: IntegrationSyncStatus.FAILED,
                message,
              });
            }
          }
        }

        pagination = this.nextPagination(response.body, pagination);
        if (!pagination) break;
      }

      if (incrementalContext.mode === "full") {
        result.customersDeleted += await this.reconcileMissingSgpCustomers(
          user.tenantId,
          seenExternalIds.customers,
          runId,
        );
        result.contractsDeleted += await this.reconcileMissingSgpContracts(
          user.tenantId,
          seenExternalIds.contracts,
          runId,
        );
        result.invoicesDeleted += await this.reconcileMissingSgpInvoices(
          user.tenantId,
          seenExternalIds.invoices,
          runId,
        );
      }
    } catch (error) {
      if (runId) {
        await this.flushSyncLogs();
        const durationMs = Date.now() - startedAt;
        await this.finishSyncRun(runId, IntegrationSyncStatus.FAILED, result, durationMs, {
          errorMessage: error instanceof Error ? error.message : String(error),
          stackTrace: error instanceof Error ? error.stack : undefined,
          cursor: pagination,
        });
      }
      throw error;
    }

    const finalResult = {
      ...result,
      durationMs: Date.now() - startedAt,
    };

    if (runId) {
      await this.flushSyncLogs();
      await this.finishSyncRun(
        runId,
        result.errors.length ? IntegrationSyncStatus.PARTIAL : IntegrationSyncStatus.COMPLETED,
        result,
        finalResult.durationMs,
        { cursor: pagination },
      );

      await this.sgpCredentials.updateSyncState(user.tenantId, request.credentialId, {
        lastSuccessfulSyncAt: new Date().toISOString(),
        lastSyncMode: incrementalContext.mode,
        lastSyncRunId: runId,
      });
    }

    this.logger.log(
      safeJsonStringify({
        event: "sgp.discover-customers.processed",
        tenantId: user.tenantId,
        ...finalResult,
      }),
    );

    return finalResult;
  }

  async debugSgp(user: AuthUser, request: SgpDiscoveryRequest) {
    const credentials = await this.resolveSgpCredentials(user.tenantId, request.credentialId, request);
    const response = await this.sgpClient.debug(
      credentials,
      request.endpoint ?? "/",
      request.payload,
    );
    return response.body;
  }

  private async buildTestCredentials(
    tenantId: string,
    credentialId: string,
    dto: TestSgpCredentialsDto,
  ): Promise<SgpRuntimeCredentials> {
    const stored = await this.sgpCredentials.resolveCredentialsById(tenantId, credentialId);

    return {
      apiUrl: dto.apiUrl ?? stored.apiUrl,
      apiPort: dto.apiPort ?? stored.apiPort,
      app: dto.app ?? stored.app,
      token: dto.token ?? stored.token,
    };
  }

  private buildInlineTestCredentials(dto: TestSgpCredentialsDto): SgpRuntimeCredentials {
    const apiUrl = dto.apiUrl?.trim();
    const app = dto.app?.trim();
    const token = dto.token?.trim();

    if (!apiUrl || !app || !token) {
      throw new BadRequestException(
        "Informe apiUrl, app e token para testar credenciais SGP.",
      );
    }

    return {
      apiUrl,
      apiPort: dto.apiPort?.trim(),
      app,
      token,
    };
  }

  private async resolveSgpCredentials(
    tenantId: string,
    credentialId?: string,
    request: SgpDiscoveryRequest = {},
  ): Promise<SgpRuntimeCredentials> {
    const stored = credentialId
      ? await this.sgpCredentials.resolveCredentialsById(tenantId, credentialId)
      : await this.sgpCredentials.resolveActiveCredentials(tenantId);

    return {
      apiUrl: stored.apiUrl,
      apiPort: stored.apiPort,
      timeoutMs: stored.timeoutMs,
      app: stored.app,
      token: stored.token,
    };
  }

  private async finishSyncRun(
    runId: string,
    status: IntegrationSyncStatus,
    counters: SyncCounters,
    durationMs: number,
    options: {
      cursor?: unknown;
      errorMessage?: string;
      stackTrace?: string;
    } = {},
  ) {
    const contractsProcessed =
      counters.contractsCreated +
      counters.contractsUpdated +
      counters.contractsUnchanged +
      counters.contractsDeleted;
    const invoicesProcessed =
      counters.invoicesCreated +
      counters.invoicesUpdated +
      counters.invoicesUnchanged +
      counters.invoicesDeleted;

    await this.prisma.integrationSyncRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        durationMs,
        processed: counters.processed,
        created: counters.created + counters.contractsCreated + counters.invoicesCreated,
        updated: counters.updated + counters.contractsUpdated + counters.invoicesUpdated,
        ignored:
          counters.ignored +
          counters.unchanged +
          counters.contractsUnchanged +
          counters.invoicesUnchanged,
        errorsCount: counters.errors.length,
        customersProcessed: counters.processed,
        customersCreated: counters.created,
        customersUpdated: counters.updated,
        customersDeleted: counters.customersDeleted,
        customersIgnored: counters.unchanged,
        contractsProcessed,
        contractsCreated: counters.contractsCreated,
        contractsUpdated: counters.contractsUpdated,
        contractsDeleted: counters.contractsDeleted,
        contractsIgnored: counters.contractsUnchanged,
        invoicesProcessed,
        invoicesCreated: counters.invoicesCreated,
        invoicesUpdated: counters.invoicesUpdated,
        invoicesDeleted: counters.invoicesDeleted,
        invoicesIgnored: counters.invoicesUnchanged,
        errors: this.toJsonValue(counters.errors.slice(0, 100)),
        stackTrace: options.stackTrace,
        syncMode: counters.syncMode,
        cursor: this.toJsonValue(options.cursor),
        errorMessage: options.errorMessage,
        metadata: this.toJsonValue({
          syncMode: counters.syncMode,
          watermark: counters.watermark,
          customers: {
            created: counters.created,
            updated: counters.updated,
            unchanged: counters.unchanged,
            deleted: counters.customersDeleted,
          },
          contracts: {
            created: counters.contractsCreated,
            updated: counters.contractsUpdated,
            unchanged: counters.contractsUnchanged,
            deleted: counters.contractsDeleted,
          },
          invoices: {
            created: counters.invoicesCreated,
            updated: counters.invoicesUpdated,
            unchanged: counters.invoicesUnchanged,
            deleted: counters.invoicesDeleted,
          },
          errors: counters.errors.slice(0, 100),
        }),
      },
    });
  }

  private async createSyncLog(input: {
    tenantId: string;
    runId: string;
    entity: IntegrationSyncEntity;
    action: string;
    status: IntegrationSyncStatus;
    externalId?: string;
    message?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    this.syncLogBuffer.push({
      tenantId: input.tenantId,
      runId: input.runId,
      entity: input.entity,
      externalId: input.externalId,
      action: input.action,
      status: input.status,
      message: input.message,
      metadata: input.metadata,
    });

    if (this.syncLogBuffer.length >= DEFAULT_BATCH_SIZE) {
      await this.flushSyncLogs();
    }
  }

  private async flushSyncLogs() {
    if (!this.syncLogBuffer.length) {
      return;
    }

    const batch = this.syncLogBuffer.splice(0, this.syncLogBuffer.length);
    await this.prisma.integrationSyncLog.createMany({ data: batch });
  }

  private nextPagination(
    body: unknown,
    currentPagination?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const root = this.isRecord(body) ? body : {};
    const pagination = this.extractPaginationFromBody(body);
    const currentOffset =
      this.numberFrom(pagination.offset) ??
      this.numberFrom(currentPagination?.offset);
    const partial =
      this.numberFrom(pagination.parcial) ??
      this.numberFrom(pagination.partial) ??
      this.numberFrom(pagination.count);
    const currentPage =
      this.numberFrom(pagination.page) ??
      this.numberFrom(pagination.pagina) ??
      this.numberFrom(currentPagination?.page) ??
      this.numberFrom(currentPagination?.pagina) ??
      1;
    const limit =
      this.numberFrom(pagination.limit) ??
      this.numberFrom(pagination.per_page) ??
      this.numberFrom(pagination.por_pagina) ??
      this.numberFrom(currentPagination?.limit) ??
      this.numberFrom(currentPagination?.per_page) ??
      this.numberFrom(currentPagination?.por_pagina);
    const total =
      this.numberFrom(pagination.total) ??
      this.numberFrom(root.total) ??
      this.numberFrom(root.count);

    if (currentOffset !== undefined && limit !== undefined && total !== undefined) {
      const pageSize = partial && partial > 0 ? partial : limit;
      const nextOffset = currentOffset + pageSize;

      if (nextOffset < total && pageSize > 0) {
        return {
          ...(currentPagination ?? {}),
          offset: nextOffset,
          limit,
        };
      }

      return undefined;
    }

    const totalPages =
      this.numberFrom(pagination.pages) ??
      this.numberFrom(pagination.total_pages) ??
      this.numberFrom(pagination.paginas);
    const computedPages = total && limit ? Math.ceil(total / limit) : undefined;
    const finalTotalPages = totalPages ?? computedPages;
    const nextValue = pagination.next ?? root.next;

    if (nextValue === false || nextValue === null) return undefined;

    if (typeof nextValue === "number") {
      return this.withPaginationStyle(currentPagination, nextValue, limit);
    }

    if (typeof nextValue === "string" && /^\d+$/.test(nextValue)) {
      return this.withPaginationStyle(currentPagination, Number(nextValue), limit);
    }

    if (nextValue && finalTotalPages === undefined) {
      return this.withPaginationStyle(currentPagination, currentPage + 1, limit);
    }

    if (finalTotalPages && currentPage < finalTotalPages) {
      return this.withPaginationStyle(currentPagination, currentPage + 1, limit);
    }

    return undefined;
  }

  private withPaginationStyle(
    currentPagination: Record<string, unknown> | undefined,
    nextPage: number,
    limit?: number,
  ) {
    const pageKey = currentPagination && "pagina" in currentPagination ? "pagina" : "page";
    const limitKey =
      currentPagination && "por_pagina" in currentPagination
        ? "por_pagina"
        : currentPagination && "per_page" in currentPagination
          ? "per_page"
          : "limit";

    return {
      ...(currentPagination ?? {}),
      [pageKey]: nextPage,
      ...(limit ? { [limitKey]: limit } : {}),
    };
  }

  private buildDiscoveryPayload(request: SgpDiscoveryRequest) {
    return {
      ...(request.payload ?? {}),
      ...(request.filters ?? {}),
      ...(request.pagination ?? {}),
    };
  }

  private buildSyncPayload(
    request: SgpDiscoveryRequest,
    incrementalContext: SgpIncrementalContext,
    pagination?: Record<string, unknown>,
  ) {
    return {
      ...(request.payload ?? {}),
      ...(request.filters ?? {}),
      ...(pagination ?? request.pagination ?? {}),
      ...(incrementalContext.mode === "incremental" ? incrementalContext.sgpFilters : {}),
    };
  }

  private resolveSyncMode(request: SgpDiscoveryRequest): SgpSyncMode {
    if (request.full === true || request.mode === "full") {
      return "full";
    }

    return "incremental";
  }

  private async resolveIncrementalContext(
    tenantId: string,
    request: SgpDiscoveryRequest,
  ): Promise<SgpIncrementalContext> {
    const mode = this.resolveSyncMode(request);

    if (mode === "full") {
      return {
        mode,
        since: null,
        sgpFilters: {},
      };
    }

    const storedState = await this.sgpCredentials.getSyncState(tenantId, request.credentialId);
    const lastRun = await this.prisma.integrationSyncRun.findFirst({
      where: {
        tenantId,
        operation: "sgp.sync-customers",
        status: {
          in: [IntegrationSyncStatus.COMPLETED, IntegrationSyncStatus.PARTIAL],
        },
      },
      orderBy: { finishedAt: "desc" },
    });

    const since = storedState.lastSuccessfulSyncAt
      ? new Date(storedState.lastSuccessfulSyncAt)
      : lastRun?.finishedAt ?? lastRun?.startedAt ?? null;

    return {
      mode,
      since,
      sgpFilters: buildSgpIncrementalFilters(since),
    };
  }

  private assertCustomerDiscoveryResponse(body: unknown, endpoint?: string) {
    if (typeof body === "string") {
      const normalized = body.toLowerCase();
      if (
        normalized.includes("<!doctype html") ||
        normalized.includes("<html") ||
        normalized.includes("documentation") ||
        normalized.includes("swagger") ||
        normalized.includes("redoc")
      ) {
        throw new BadGatewayException({
          code: "SGP_UNEXPECTED_RESPONSE",
          message:
            "O SGP retornou uma página de documentação/HTML em vez da lista de clientes. Verifique a URL da API SGP e o endpoint de clientes.",
          context: {
            endpoint,
          },
        });
      }
    }

    if (this.isRecord(body)) {
      const keys = Object.keys(body).map((key) => key.toLowerCase());
      const looksLikeOpenApi =
        keys.includes("openapi") ||
        keys.includes("swagger") ||
        (keys.includes("info") && keys.includes("paths"));

      if (looksLikeOpenApi) {
        throw new BadGatewayException({
          code: "SGP_UNEXPECTED_RESPONSE",
          message:
            "O SGP retornou metadados de documentação em vez da lista de clientes. Verifique a URL da API SGP e o endpoint de clientes.",
          context: {
            endpoint,
          },
        });
      }
    }
  }

  private extractCustomers(body: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(body)) {
      return body.filter(this.isRecord);
    }

    if (!this.isRecord(body)) {
      return [];
    }

    const candidateKeys = ["clientes", "cliente", "data", "results", "registros", "objects", "items"];

    for (const key of candidateKeys) {
      const value = body[key];
      if (Array.isArray(value)) {
        return value.filter(this.isRecord).map((customer) =>
          this.attachUraRelations(customer, body),
        );
      }
      if (this.isRecord(value)) {
        return [this.attachUraRelations(value, body)];
      }
    }

    return this.looksLikeCustomer(body) ? [this.attachUraRelations(body, body)] : [];
  }

  private mapSgpCustomer(raw: Record<string, unknown>): SgpCustomerMapping {
    const primaryContract = this.firstRecord(raw, ["contrato", "contratos", "__sgpContratos"]);
    const primaryService =
      this.firstRecord(raw, ["servico", "serviço", "servicos", "serviços"]) ??
      this.firstRecord(primaryContract, ["servico", "serviço", "servicos", "serviços"]);
    const primaryTitle = this.firstRecord(raw, ["titulo", "titulos", "títulos", "__sgpTitulos"]);
    const externalId = this.firstString(raw, [
      "id",
      "cliente_id",
      "idcliente",
      "codigo",
      "codcli",
      "cod_cliente",
      "contrato",
      "idcontrato",
    ]) ?? this.firstString(primaryContract, ["id", "contrato", "idcontrato"]);
    const document = this.normalizeDocument(
      this.firstString(raw, [
        "cpfcnpj",
        "cpf_cnpj",
        "cpf",
        "cnpj",
        "documento",
        "document",
      ]),
    );
    const name =
      this.firstString(raw, [
        "nome",
        "razao_social",
        "razaosocial",
        "nomecliente",
        "cliente",
        "name",
      ]) ?? `Cliente SGP ${externalId ?? document ?? "sem identificador"}`;
    const email = this.firstString(raw, ["email", "e_mail", "mail"]);
    const phone = this.firstString(raw, [
      "telefone",
      "fone",
      "celular",
      "whatsapp",
      "contato",
      "phone",
    ]);
    const planName = this.firstString(raw, [
      "plano",
      "plano_nome",
      "nome_plano",
      "servico",
      "serviço",
    ]) ?? this.extractPlanName(primaryService);

    return {
      customer: {
        externalId,
        name,
        document,
        email,
        phone,
        planName,
        status: this.mapCustomerStatus(raw, primaryContract, primaryService, primaryTitle),
        address: this.mapAddress(raw, primaryContract, primaryService),
        metadata: {
          source: "SGP",
          importedAt: new Date().toISOString(),
          externalId,
          pagination: this.toJsonValue(raw.__sgpPagination),
        },
      },
      contracts: this.extractArray(raw, ["__sgpContratos", "contratos", "contrato"]),
      invoices: this.extractArray(raw, ["__sgpTitulos", "titulos", "títulos", "titulo"]),
    };
  }

  private async upsertContracts(
    tenantId: string,
    customerId: string,
    contracts: Array<Record<string, unknown>>,
    runId?: string,
    incrementalContext?: SgpIncrementalContext,
  ) {
    const result = { created: 0, updated: 0, unchanged: 0, deleted: 0 };
    const contractExternalIds = contracts
      .map((contract) => this.contractExternalId(contract))
      .filter((externalId): externalId is string => Boolean(externalId));
    const existingRows = contractExternalIds.length
      ? await this.prisma.contract.findMany({
          where: {
            tenantId,
            externalId: { in: contractExternalIds },
          },
        })
      : [];
    const existingByExternalId = new Map(existingRows.map((row) => [row.externalId, row]));

    for (const contract of contracts) {
      const externalId = this.contractExternalId(contract);
      if (!externalId) continue;

      if (isSgpDeletedRecord(contract)) {
        const removed = await this.softDeleteSgpContract(tenantId, externalId, runId);
        if (removed) {
          result.deleted += 1;
        }
        continue;
      }

      if (
        incrementalContext?.mode === "incremental" &&
        incrementalContext.since &&
        !isChangedSince(contract, incrementalContext.since)
      ) {
        result.unchanged += 1;
        if (runId) {
          await this.createSyncLog({
            tenantId,
            runId,
            entity: IntegrationSyncEntity.CONTRACT,
            externalId,
            action: "unchanged",
            status: IntegrationSyncStatus.SKIPPED,
          });
        }
        continue;
      }

      const service = this.firstRecord(contract, ["servico", "serviço", "servicos", "serviços"]);
      const payload = {
        customerId,
        status: this.mapContractStatus(contract, service),
        planName: this.extractPlanName(service) ?? this.firstString(contract, ["plano", "plano_nome", "nome_plano"]),
        serviceLogin: this.firstString(service, ["login", "usuario", "usuário", "pppoe"]),
        address: this.mapAddress({}, contract, service),
        startedAt: this.parseDate(this.firstString(contract, ["data_inicio", "data_instalacao", "data_ativacao"])),
        endedAt: this.parseDate(this.firstString(contract, ["data_fim", "data_cancelamento"])),
      };
      const contentHash = hashContractPayload(payload);
      const existing = existingByExternalId.get(externalId);

      if (existing && readSgpContentHash(existing.metadata) === contentHash) {
        result.unchanged += 1;
        if (runId) {
          await this.createSyncLog({
            tenantId,
            runId,
            entity: IntegrationSyncEntity.CONTRACT,
            externalId,
            action: "unchanged",
            status: IntegrationSyncStatus.SKIPPED,
          });
        }
        continue;
      }

      const data = {
        ...payload,
        deletedAt: null,
        metadata: withSgpContentHash(
          withSgpRestoredMetadata(
            this.toJsonValue({
              source: "SGP",
              raw: contract,
            }),
          ),
          contentHash,
        ),
      };

      if (existing) {
        await this.prisma.contract.update({
          where: { id: existing.id },
          data,
        });
        result.updated += 1;
        if (runId) {
          await this.createSyncLog({
            tenantId,
            runId,
            entity: IntegrationSyncEntity.CONTRACT,
            externalId,
            action: "updated",
            status: IntegrationSyncStatus.COMPLETED,
          });
        }
      } else {
        const created = await this.prisma.contract.create({
          data: {
            tenantId,
            externalId,
            ...data,
          },
        });
        existingByExternalId.set(externalId, created);
        result.created += 1;
        if (runId) {
          await this.createSyncLog({
            tenantId,
            runId,
            entity: IntegrationSyncEntity.CONTRACT,
            externalId,
            action: "created",
            status: IntegrationSyncStatus.COMPLETED,
          });
        }
      }
    }

    return result;
  }

  private async upsertInvoices(
    tenantId: string,
    customerId: string,
    invoices: Array<Record<string, unknown>>,
    runId?: string,
    incrementalContext?: SgpIncrementalContext,
  ) {
    const result = { created: 0, updated: 0, unchanged: 0, deleted: 0 };
    const invoiceExternalIds = invoices
      .map((invoice) => this.invoiceExternalId(invoice))
      .filter((externalId): externalId is string => Boolean(externalId));
    const contractExternalIds = [
      ...new Set(
        invoices
          .map((invoice) =>
            this.firstString(invoice, [
              "contrato",
              "idcontrato",
              "contrato_id",
              "id_contrato",
            ]),
          )
          .filter((externalId): externalId is string => Boolean(externalId)),
      ),
    ];
    const [existingRows, contractRows] = await Promise.all([
      invoiceExternalIds.length
        ? this.prisma.invoice.findMany({
            where: {
              tenantId,
              externalId: { in: invoiceExternalIds },
            },
          })
        : Promise.resolve([]),
      contractExternalIds.length
        ? this.prisma.contract.findMany({
            where: {
              tenantId,
              externalId: { in: contractExternalIds },
            },
            select: { id: true, externalId: true },
          })
        : Promise.resolve([]),
    ]);
    const existingByExternalId = new Map(existingRows.map((row) => [row.externalId, row]));
    const contractIdByExternalId = new Map(contractRows.map((row) => [row.externalId, row.id]));

    for (const invoice of invoices) {
      const externalId = this.invoiceExternalId(invoice);
      if (!externalId) continue;

      if (isSgpDeletedRecord(invoice)) {
        const removed = await this.softDeleteSgpInvoice(tenantId, externalId, runId);
        if (removed) {
          result.deleted += 1;
        }
        continue;
      }

      if (
        incrementalContext?.mode === "incremental" &&
        incrementalContext.since &&
        !isChangedSince(invoice, incrementalContext.since)
      ) {
        result.unchanged += 1;
        if (runId) {
          await this.createSyncLog({
            tenantId,
            runId,
            entity: IntegrationSyncEntity.INVOICE,
            externalId,
            action: "unchanged",
            status: IntegrationSyncStatus.SKIPPED,
          });
        }
        continue;
      }

      const contractExternalId = this.firstString(invoice, [
        "contrato",
        "idcontrato",
        "contrato_id",
        "id_contrato",
      ]);
      const contractId = contractExternalId
        ? contractIdByExternalId.get(contractExternalId)
        : undefined;
      const payload = {
        customerId,
        contractId,
        status: this.mapInvoiceStatus(invoice),
        amountCents: this.parseMoneyToCents(
          this.firstString(invoice, ["valor", "valor_total", "total", "amount"]),
        ),
        dueDate: this.parseDate(this.firstString(invoice, ["vencimento", "data_vencimento", "dueDate"])),
        paidAt: this.parseDate(this.firstString(invoice, ["pagamento", "data_pagamento", "paidAt"])),
      };
      const contentHash = hashInvoicePayload(payload);
      const existing = existingByExternalId.get(externalId);

      if (existing && readSgpContentHash(existing.metadata) === contentHash) {
        result.unchanged += 1;
        if (runId) {
          await this.createSyncLog({
            tenantId,
            runId,
            entity: IntegrationSyncEntity.INVOICE,
            externalId,
            action: "unchanged",
            status: IntegrationSyncStatus.SKIPPED,
          });
        }
        continue;
      }

      const data = {
        ...payload,
        deletedAt: null,
        metadata: withSgpContentHash(
          withSgpRestoredMetadata(
            this.toJsonValue({
              source: "SGP",
              raw: invoice,
            }),
          ),
          contentHash,
        ),
      };

      if (existing) {
        await this.prisma.invoice.update({
          where: { id: existing.id },
          data,
        });
        result.updated += 1;
        if (runId) {
          await this.createSyncLog({
            tenantId,
            runId,
            entity: IntegrationSyncEntity.INVOICE,
            externalId,
            action: "updated",
            status: IntegrationSyncStatus.COMPLETED,
          });
        }
      } else {
        const created = await this.prisma.invoice.create({
          data: {
            tenantId,
            externalId,
            ...data,
          },
        });
        existingByExternalId.set(externalId, created);
        result.created += 1;
        if (runId) {
          await this.createSyncLog({
            tenantId,
            runId,
            entity: IntegrationSyncEntity.INVOICE,
            externalId,
            action: "created",
            status: IntegrationSyncStatus.COMPLETED,
          });
        }
      }
    }

    return result;
  }

  private contractExternalId(contract: Record<string, unknown>) {
    return this.firstString(contract, [
      "id",
      "contrato",
      "idcontrato",
      "contrato_id",
      "id_contrato",
      "numero",
      "codigo",
    ]);
  }

  private invoiceExternalId(invoice: Record<string, unknown>) {
    return this.firstString(invoice, [
      "id",
      "titulo",
      "idtitulo",
      "titulo_id",
      "id_titulo",
      "numero_documento",
      "documento",
      "nosso_numero",
    ]);
  }

  private mapContractStatus(
    contract: Record<string, unknown>,
    service?: Record<string, unknown>,
  ) {
    const status = String(
      this.firstString(contract, ["status", "situacao", "situação", "ativo"]) ??
        this.firstString(service, ["status", "situacao", "situação"]) ??
        "",
    ).toLowerCase();

    if (status.includes("cancel")) return ContractStatus.CANCELED;
    if (status.includes("susp") || status.includes("bloque")) return ContractStatus.SUSPENDED;
    if (status.includes("inativ") || status.includes("desativ")) return ContractStatus.INACTIVE;
    if (status.includes("ativo") || status === "true" || status === "1") return ContractStatus.ACTIVE;
    return ContractStatus.UNKNOWN;
  }

  private mapInvoiceStatus(invoice: Record<string, unknown>) {
    const status = String(
      this.firstString(invoice, ["status", "situacao", "situação", "status_titulo"]) ?? "",
    ).toLowerCase();

    if (status.includes("pago") || status.includes("baix") || status.includes("liquid")) {
      return InvoiceStatus.PAID;
    }
    if (status.includes("cancel")) return InvoiceStatus.CANCELED;
    if (status.includes("venc") || status.includes("atras") || status.includes("inadimpl")) {
      return InvoiceStatus.OVERDUE;
    }
    if (status.includes("abert") || status.includes("pend")) return InvoiceStatus.OPEN;
    return InvoiceStatus.UNKNOWN;
  }

  private mapCustomerStatus(
    raw: Record<string, unknown>,
    contract?: Record<string, unknown>,
    service?: Record<string, unknown>,
    title?: Record<string, unknown>,
  ) {
    const status = String(
      this.firstString(raw, ["status", "situacao", "situação", "ativo"]) ??
        this.firstString(contract, ["status", "situacao", "situação"]) ??
        this.firstString(service, ["status", "situacao", "situação"]) ??
        this.firstString(title, ["status", "situacao", "situação"]) ??
        "",
    ).toLowerCase();

    if (
      status.includes("inadimpl") ||
      status.includes("bloque") ||
      status.includes("atras")
    ) {
      return CustomerStatus.OVERDUE;
    }

    if (
      status.includes("cancel") ||
      status.includes("inativ") ||
      status.includes("desativ")
    ) {
      return CustomerStatus.INACTIVE;
    }

    if (status.includes("ativo") || status === "true" || status === "1") {
      return CustomerStatus.ACTIVE;
    }

    return CustomerStatus.PROSPECT;
  }

  private mapAddress(
    raw: Record<string, unknown>,
    contract?: Record<string, unknown>,
    service?: Record<string, unknown>,
  ) {
    const contractAddress = this.firstRecord(contract, ["endereco", "endereço"]);
    const serviceAddress = this.firstRecord(service, ["endereco", "endereço"]);
    const source = serviceAddress ?? contractAddress ?? raw;
    const address = {
      street: this.firstString(source, ["endereco", "logradouro", "rua"]),
      number: this.firstString(source, ["numero", "número", "num"]),
      district: this.firstString(source, ["bairro"]),
      city: this.firstString(source, ["cidade", "city"]),
      state: this.firstString(source, ["uf", "estado", "state"]),
      zipCode: this.firstString(source, ["cep", "zipcode"]),
      complement: this.firstString(source, ["complemento", "referencia"]),
    };
    const hasValue = Object.values(address).some(Boolean);
    return hasValue ? address : undefined;
  }

  private firstString(
    raw: Record<string, unknown> | undefined,
    keys: string[],
  ): string | undefined {
    if (!raw) return undefined;
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      if (typeof value === "boolean") return String(value);
    }
    return undefined;
  }

  private normalizeDocument(value?: string) {
    const normalized = value?.replace(/\D/g, "");
    return normalized || undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private firstRecord(
    raw: Record<string, unknown> | undefined,
    keys: string[],
  ): Record<string, unknown> | undefined {
    if (!raw) return undefined;

    for (const key of keys) {
      const value = raw[key];
      if (this.isRecord(value)) return value;
      if (Array.isArray(value)) {
        const first = value.find(this.isRecord);
        if (first) return first;
      }
    }

    return undefined;
  }

  private attachUraRelations(
    customer: Record<string, unknown>,
    root: Record<string, unknown>,
  ) {
    const contratos = this.extractArray(root, ["contratos", "contrato"]);
    const titulos = this.extractArray(root, ["titulos", "títulos", "titulo"]);
    const relatedContracts = this.findRelatedRecords(customer, contratos);
    const relatedTitles = this.findRelatedRecords(customer, titulos);

    return {
      ...customer,
      __sgpContratos: relatedContracts.length ? relatedContracts : undefined,
      __sgpTitulos: relatedTitles.length ? relatedTitles : undefined,
      __sgpPagination: this.extractPagination(root),
    };
  }

  private extractPlanName(service?: Record<string, unknown>) {
    const plan = this.firstRecord(service, ["plano"]);
    return (
      this.firstString(plan, ["descricao", "descrição", "nome"]) ??
      this.firstString(service, ["plano", "plano_nome", "nome_plano"])
    );
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private parseDate(value?: string) {
    if (!value) return undefined;
    const trimmed = value.trim();

    if (!trimmed) return undefined;

    const brDate = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brDate) {
      const [, day, month, year] = brDate;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private parseMoneyToCents(value?: string) {
    if (!value) return undefined;
    const normalized = value
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const parsed = Number(normalized);

    return Number.isFinite(parsed) ? Math.round(parsed * 100) : undefined;
  }

  private extractArray(root: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = root[key];
      if (Array.isArray(value)) return value.filter(this.isRecord);
      if (this.isRecord(value)) return [value];
    }

    return [];
  }

  private findRelatedRecords(
    customer: Record<string, unknown>,
    records: Array<Record<string, unknown>>,
  ) {
    if (!records.length) return [];

    const customerKeys = this.customerRelationKeys(customer);
    if (!customerKeys.size) {
      return records.length === 1 ? records : [];
    }

    const related = records.filter((record) => {
      const recordKeys = this.customerRelationKeys(record);
      for (const key of recordKeys) {
        if (customerKeys.has(key)) return true;
      }
      return false;
    });

    return related.length ? related : records.length === 1 ? records : [];
  }

  private customerRelationKeys(record: Record<string, unknown>) {
    const keys = new Set<string>();
    const scalarKeys = [
      "id",
      "cliente_id",
      "idcliente",
      "id_cliente",
      "codigo",
      "codcli",
      "cod_cliente",
      "cpfcnpj",
      "cpf_cnpj",
      "cpf",
      "cnpj",
      "documento",
    ];

    for (const key of scalarKeys) {
      const value = this.firstString(record, [key]);
      if (value) keys.add(this.normalizeRelationKey(value));
    }

    const nestedCustomer = this.firstRecord(record, ["cliente", "customer"]);
    if (nestedCustomer) {
      for (const key of this.customerRelationKeys(nestedCustomer)) {
        keys.add(key);
      }
    }

    return keys;
  }

  private normalizeRelationKey(value: string) {
    const onlyDigits = value.replace(/\D/g, "");
    return onlyDigits || value.trim().toLowerCase();
  }

  private extractPagination(root: Record<string, unknown>) {
    const paginationKeys = [
      "pagination",
      "paginacao",
      "paginação",
      "offset",
      "parcial",
      "partial",
      "page",
      "pagina",
      "pages",
      "total_pages",
      "paginas",
      "limit",
      "per_page",
      "por_pagina",
      "total",
      "count",
      "next",
      "previous",
    ];
    const pagination = Object.fromEntries(
      paginationKeys
        .filter((key) => root[key] !== undefined)
        .map((key) => [key, root[key]]),
    );

    return Object.keys(pagination).length ? pagination : undefined;
  }

  private extractPaginationFromBody(body: unknown): Record<string, unknown> {
    if (!this.isRecord(body)) return {};

    const nested = this.firstRecord(body, [
      "pagination",
      "paginacao",
      "paginação",
      "meta",
    ]);

    return {
      ...(nested ?? {}),
      ...(this.extractPagination(body) ?? {}),
    };
  }

  private numberFrom(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private looksLikeCustomer(value: Record<string, unknown>) {
    return Boolean(
      this.firstString(value, [
        "cpfcnpj",
        "cpf_cnpj",
        "cpf",
        "cnpj",
        "documento",
        "nome",
        "razao_social",
        "nomecliente",
        "cliente",
      ]),
    );
  }

  private trackRootExternalIds(body: Record<string, unknown>, seen: SgpSeenExternalIds) {
    for (const contract of this.extractArray(body, ["contratos", "contrato"])) {
      const externalId = this.contractExternalId(contract);
      if (externalId) seen.contracts.add(externalId);
    }

    for (const invoice of this.extractArray(body, ["titulos", "títulos", "titulo"])) {
      const externalId = this.invoiceExternalId(invoice);
      if (externalId) seen.invoices.add(externalId);
    }
  }

  private trackMappedExternalIds(mapped: SgpCustomerMapping, seen: SgpSeenExternalIds) {
    if (mapped.customer.externalId) {
      seen.customers.add(mapped.customer.externalId);
    }

    for (const contract of mapped.contracts) {
      const externalId = this.contractExternalId(contract);
      if (externalId) seen.contracts.add(externalId);
    }

    for (const invoice of mapped.invoices) {
      const externalId = this.invoiceExternalId(invoice);
      if (externalId) seen.invoices.add(externalId);
    }
  }

  private collectContractExternalIds(contracts: Array<Record<string, unknown>>) {
    const seen = new Set<string>();
    for (const contract of contracts) {
      const externalId = this.contractExternalId(contract);
      if (externalId) seen.add(externalId);
    }
    return seen;
  }

  private collectInvoiceExternalIds(invoices: Array<Record<string, unknown>>) {
    const seen = new Set<string>();
    for (const invoice of invoices) {
      const externalId = this.invoiceExternalId(invoice);
      if (externalId) seen.add(externalId);
    }
    return seen;
  }

  private findSgpCustomerRecord(
    tenantId: string,
    externalId?: string,
    document?: string,
  ) {
    if (!externalId && !document) {
      return null;
    }

    return this.prisma.customer.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          ...(externalId ? [{ ispAccountCode: externalId }] : []),
          ...(document ? [{ document }] : []),
        ],
      },
    });
  }

  private async softDeleteSgpCustomer(
    tenantId: string,
    externalId: string,
    runId?: string,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        tenantId,
        ispAccountCode: externalId,
        deletedAt: null,
      },
    });

    if (!customer || !isSgpManagedMetadata(customer.metadata)) {
      return false;
    }

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        deletedAt: new Date(),
        status: CustomerStatus.INACTIVE,
        metadata: withSgpDeletionMetadata(customer.metadata, "removed_in_sgp"),
      },
    });

    if (runId) {
      await this.createSyncLog({
        tenantId,
        runId,
        entity: IntegrationSyncEntity.CUSTOMER,
        externalId,
        action: "deleted",
        status: IntegrationSyncStatus.COMPLETED,
        message: "Cliente removido no SGP e marcado como excluído no CRM.",
      });
    }

    return true;
  }

  private async softDeleteSgpContract(
    tenantId: string,
    externalId: string,
    runId?: string,
  ) {
    const contract = await this.prisma.contract.findUnique({
      where: {
        tenantId_externalId: {
          tenantId,
          externalId,
        },
      },
    });

    if (!contract || contract.deletedAt || !isSgpManagedMetadata(contract.metadata)) {
      return false;
    }

    await this.prisma.contract.update({
      where: { id: contract.id },
      data: {
        deletedAt: new Date(),
        status: ContractStatus.CANCELED,
        metadata: withSgpDeletionMetadata(contract.metadata, "removed_in_sgp"),
      },
    });

    if (runId) {
      await this.createSyncLog({
        tenantId,
        runId,
        entity: IntegrationSyncEntity.CONTRACT,
        externalId,
        action: "deleted",
        status: IntegrationSyncStatus.COMPLETED,
      });
    }

    return true;
  }

  private async softDeleteSgpInvoice(
    tenantId: string,
    externalId: string,
    runId?: string,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: {
        tenantId_externalId: {
          tenantId,
          externalId,
        },
      },
    });

    if (!invoice || invoice.deletedAt || !isSgpManagedMetadata(invoice.metadata)) {
      return false;
    }

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        deletedAt: new Date(),
        status: InvoiceStatus.CANCELED,
        metadata: withSgpDeletionMetadata(invoice.metadata, "removed_in_sgp"),
      },
    });

    if (runId) {
      await this.createSyncLog({
        tenantId,
        runId,
        entity: IntegrationSyncEntity.INVOICE,
        externalId,
        action: "deleted",
        status: IntegrationSyncStatus.COMPLETED,
      });
    }

    return true;
  }

  private async reconcileMissingSgpCustomers(
    tenantId: string,
    seenExternalIds: Set<string>,
    runId?: string,
  ) {
    const customers = await this.prisma.customer.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ispAccountCode: { not: null },
      },
      select: {
        id: true,
        ispAccountCode: true,
        metadata: true,
      },
    });

    const toDelete = customers.filter(
      (customer) =>
        customer.ispAccountCode &&
        isSgpManagedMetadata(customer.metadata) &&
        !seenExternalIds.has(customer.ispAccountCode),
    );

    let deleted = 0;
    for (const batch of chunkArray(toDelete, RECONCILE_BATCH_SIZE)) {
      await Promise.all(
        batch.map(async (customer) => {
          await this.prisma.customer.update({
            where: { id: customer.id },
            data: {
              deletedAt: new Date(),
              status: CustomerStatus.INACTIVE,
              metadata: withSgpDeletionMetadata(
                customer.metadata,
                "missing_in_sgp_full_sync",
              ),
            },
          });

          if (runId) {
            await this.createSyncLog({
              tenantId,
              runId,
              entity: IntegrationSyncEntity.CUSTOMER,
              externalId: customer.ispAccountCode ?? undefined,
              action: "deleted",
              status: IntegrationSyncStatus.COMPLETED,
              message: "Cliente ausente no SGP durante sincronização completa.",
            });
          }
        }),
      );
      deleted += batch.length;
    }

    return deleted;
  }

  private async reconcileMissingSgpContracts(
    tenantId: string,
    seenExternalIds: Set<string>,
    runId?: string,
  ) {
    const contracts = await this.prisma.contract.findMany({
      where: {
        tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        externalId: true,
        metadata: true,
      },
    });

    const toDelete = contracts.filter(
      (contract) =>
        isSgpManagedMetadata(contract.metadata) && !seenExternalIds.has(contract.externalId),
    );

    let deleted = 0;
    for (const batch of chunkArray(toDelete, RECONCILE_BATCH_SIZE)) {
      await Promise.all(
        batch.map(async (contract) => {
          await this.prisma.contract.update({
            where: { id: contract.id },
            data: {
              deletedAt: new Date(),
              status: ContractStatus.CANCELED,
              metadata: withSgpDeletionMetadata(
                contract.metadata,
                "missing_in_sgp_full_sync",
              ),
            },
          });

          if (runId) {
            await this.createSyncLog({
              tenantId,
              runId,
              entity: IntegrationSyncEntity.CONTRACT,
              externalId: contract.externalId,
              action: "deleted",
              status: IntegrationSyncStatus.COMPLETED,
            });
          }
        }),
      );
      deleted += batch.length;
    }

    return deleted;
  }

  private async reconcileMissingSgpInvoices(
    tenantId: string,
    seenExternalIds: Set<string>,
    runId?: string,
  ) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        externalId: true,
        metadata: true,
      },
    });

    const toDelete = invoices.filter(
      (invoice) =>
        isSgpManagedMetadata(invoice.metadata) && !seenExternalIds.has(invoice.externalId),
    );

    let deleted = 0;
    for (const batch of chunkArray(toDelete, RECONCILE_BATCH_SIZE)) {
      await Promise.all(
        batch.map(async (invoice) => {
          await this.prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              deletedAt: new Date(),
              status: InvoiceStatus.CANCELED,
              metadata: withSgpDeletionMetadata(
                invoice.metadata,
                "missing_in_sgp_full_sync",
              ),
            },
          });

          if (runId) {
            await this.createSyncLog({
              tenantId,
              runId,
              entity: IntegrationSyncEntity.INVOICE,
              externalId: invoice.externalId,
              action: "deleted",
              status: IntegrationSyncStatus.COMPLETED,
            });
          }
        }),
      );
      deleted += batch.length;
    }

    return deleted;
  }

  private async reconcileMissingSgpContractsForCustomer(
    tenantId: string,
    customerId: string,
    seenExternalIds: Set<string>,
    runId?: string,
  ) {
    const contracts = await this.prisma.contract.findMany({
      where: {
        tenantId,
        customerId,
        deletedAt: null,
      },
      select: {
        id: true,
        externalId: true,
        metadata: true,
      },
    });

    const toDelete = contracts.filter(
      (contract) =>
        isSgpManagedMetadata(contract.metadata) && !seenExternalIds.has(contract.externalId),
    );

    let deleted = 0;
    for (const batch of chunkArray(toDelete, RECONCILE_BATCH_SIZE)) {
      await Promise.all(
        batch.map(async (contract) => {
          await this.prisma.contract.update({
            where: { id: contract.id },
            data: {
              deletedAt: new Date(),
              status: ContractStatus.CANCELED,
              metadata: withSgpDeletionMetadata(
                contract.metadata,
                "missing_in_sgp_customer_sync",
              ),
            },
          });

          if (runId) {
            await this.createSyncLog({
              tenantId,
              runId,
              entity: IntegrationSyncEntity.CONTRACT,
              externalId: contract.externalId,
              action: "deleted",
              status: IntegrationSyncStatus.COMPLETED,
            });
          }
        }),
      );
      deleted += batch.length;
    }

    return deleted;
  }

  private async reconcileMissingSgpInvoicesForCustomer(
    tenantId: string,
    customerId: string,
    seenExternalIds: Set<string>,
    runId?: string,
  ) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        customerId,
        deletedAt: null,
      },
      select: {
        id: true,
        externalId: true,
        metadata: true,
      },
    });

    const toDelete = invoices.filter(
      (invoice) =>
        isSgpManagedMetadata(invoice.metadata) && !seenExternalIds.has(invoice.externalId),
    );

    let deleted = 0;
    for (const batch of chunkArray(toDelete, RECONCILE_BATCH_SIZE)) {
      await Promise.all(
        batch.map(async (invoice) => {
          await this.prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              deletedAt: new Date(),
              status: InvoiceStatus.CANCELED,
              metadata: withSgpDeletionMetadata(
                invoice.metadata,
                "missing_in_sgp_customer_sync",
              ),
            },
          });

          if (runId) {
            await this.createSyncLog({
              tenantId,
              runId,
              entity: IntegrationSyncEntity.INVOICE,
              externalId: invoice.externalId,
              action: "deleted",
              status: IntegrationSyncStatus.COMPLETED,
            });
          }
        }),
      );
      deleted += batch.length;
    }

    return deleted;
  }
}
