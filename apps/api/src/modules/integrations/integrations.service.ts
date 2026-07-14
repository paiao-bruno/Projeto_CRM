import { BadGatewayException, Injectable, Logger, NotFoundException } from "@nestjs/common";
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
import { SgpClientService } from "./sgp/sgp-client.service";
import { SgpDiscoveryRequest } from "./sgp/types/sgp-client.types";

type SgpCustomerMapping = {
  customer: ExternalCustomerInput;
  contracts: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
};

type SyncCounters = {
  processed: number;
  created: number;
  updated: number;
  contractsCreated: number;
  contractsUpdated: number;
  invoicesCreated: number;
  invoicesUpdated: number;
  ignored: number;
  errors: Array<{ index: number; message: string }>;
};

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  private readonly runningCustomerSyncs = new Set<string>();

  constructor(
    private readonly sgpClient: SgpClientService,
    private readonly customersService: CustomersService,
    private readonly prisma: PrismaService,
  ) {}

  async testSgpAuth(request: SgpDiscoveryRequest = {}) {
    const response = await this.sgpClient.testAuth(
      request.payload,
      request.endpoint,
    );
    return response.body;
  }

  async discoverSgpCustomers(user: AuthUser, request: SgpDiscoveryRequest = {}) {
    const response = await this.sgpClient.discoverCustomers(
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
          operation: "sgp.sync-customers",
          status: IntegrationSyncStatus.SKIPPED,
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 0,
          metadata: {
            reason: "sync_already_running",
          },
        },
      });
      this.logger.warn(
        JSON.stringify({
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
    const run = await this.prisma.integrationSyncRun.create({
      data: {
        tenantId: user.tenantId,
        triggeredById: user.memberId,
        operation: "sgp.sync-customers",
        status: IntegrationSyncStatus.RUNNING,
        cursor: this.toJsonValue(request.pagination),
      },
    });

    void this.processSgpCustomers(user, request, run.id)
      .then((result) => {
        this.logger.log(
          JSON.stringify({
            event: "sgp.sync-customers.finished",
            tenantId: user.tenantId,
            runId: run.id,
            ...result,
          }),
        );
      })
      .catch((error) => {
        this.logger.error(
          JSON.stringify({
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
      message: "Sincronização de clientes SGP iniciada em background.",
    };
  }

  getSgpSyncStatus(tenantId: string) {
    return this.prisma.integrationSyncRun.findFirst({
      where: {
        tenantId,
        operation: "sgp.sync-customers",
      },
      include: {
        logs: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
      orderBy: { startedAt: "desc" },
    });
  }

  listSgpSyncRuns(tenantId: string) {
    return this.prisma.integrationSyncRun.findMany({
      where: {
        tenantId,
        operation: "sgp.sync-customers",
      },
      include: {
        logs: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
      orderBy: { startedAt: "desc" },
      take: 25,
    });
  }

  async getSgpSyncRun(tenantId: string, id: string) {
    const run = await this.prisma.integrationSyncRun.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        logs: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!run) {
      throw new NotFoundException("Execução de sincronização não encontrada.");
    }

    return run;
  }

  private async processSgpCustomers(
    user: AuthUser,
    request: SgpDiscoveryRequest = {},
    runId?: string,
  ) {
    const startedAt = Date.now();
    const result: SyncCounters = {
      processed: 0,
      created: 0,
      updated: 0,
      contractsCreated: 0,
      contractsUpdated: 0,
      invoicesCreated: 0,
      invoicesUpdated: 0,
      ignored: 0,
      errors: [] as Array<{ index: number; message: string }>,
    };
    let pageIndex = 0;
    let pagination = request.pagination;

    try {
      while (true) {
        pageIndex += 1;
        const response = await this.sgpClient.discoverCustomers(
          this.buildDiscoveryPayload({ ...request, pagination }),
        );
        this.assertCustomerDiscoveryResponse(response.body, request.endpoint);
        const rawCustomers = this.extractCustomers(response.body);
        result.processed += rawCustomers.length;

        for (const [index, rawCustomer] of rawCustomers.entries()) {
          const globalIndex = result.processed - rawCustomers.length + index;
          try {
            const mapped = this.mapSgpCustomer(rawCustomer);

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

            const upsert = await this.customersService.upsertFromExternalSource(
              user.tenantId,
              user.memberId,
              mapped.customer,
            );

            if (upsert.operation === "created") {
              result.created += 1;
            } else {
              result.updated += 1;
            }
            if (runId) {
              await this.createSyncLog({
                tenantId: user.tenantId,
                runId,
                entity: IntegrationSyncEntity.CUSTOMER,
                externalId: mapped.customer.externalId ?? mapped.customer.document,
                action: upsert.operation,
                status: IntegrationSyncStatus.COMPLETED,
                metadata: this.toJsonValue({ customerId: upsert.customer.id }),
              });
            }

            const contractUpserts = await this.upsertContracts(
              user.tenantId,
              upsert.customer.id,
              mapped.contracts,
              runId,
            );
            result.contractsCreated += contractUpserts.created;
            result.contractsUpdated += contractUpserts.updated;

            const invoiceUpserts = await this.upsertInvoices(
              user.tenantId,
              upsert.customer.id,
              mapped.invoices,
              runId,
            );
            result.invoicesCreated += invoiceUpserts.created;
            result.invoicesUpdated += invoiceUpserts.updated;
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
    } catch (error) {
      if (runId) {
        const durationMs = Date.now() - startedAt;
        await this.finishSyncRun(runId, IntegrationSyncStatus.FAILED, result, durationMs, {
          errorMessage: error instanceof Error ? error.message : String(error),
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
      await this.finishSyncRun(
        runId,
        result.errors.length ? IntegrationSyncStatus.PARTIAL : IntegrationSyncStatus.COMPLETED,
        result,
        finalResult.durationMs,
        { cursor: pagination },
      );
    }

    this.logger.log(
      JSON.stringify({
        event: "sgp.discover-customers.processed",
        tenantId: user.tenantId,
        ...finalResult,
      }),
    );

    return finalResult;
  }

  async debugSgp(request: SgpDiscoveryRequest) {
    const response = await this.sgpClient.debug(
      request.endpoint ?? "/",
      request.payload,
    );
    return response.body;
  }

  private async finishSyncRun(
    runId: string,
    status: IntegrationSyncStatus,
    counters: SyncCounters,
    durationMs: number,
    options: { cursor?: unknown; errorMessage?: string } = {},
  ) {
    await this.prisma.integrationSyncRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        durationMs,
        processed: counters.processed,
        created: counters.created + counters.contractsCreated + counters.invoicesCreated,
        updated: counters.updated + counters.contractsUpdated + counters.invoicesUpdated,
        ignored: counters.ignored,
        errorsCount: counters.errors.length,
        cursor: this.toJsonValue(options.cursor),
        errorMessage: options.errorMessage,
        metadata: this.toJsonValue({
          customers: {
            created: counters.created,
            updated: counters.updated,
          },
          contracts: {
            created: counters.contractsCreated,
            updated: counters.contractsUpdated,
          },
          invoices: {
            created: counters.invoicesCreated,
            updated: counters.invoicesUpdated,
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
    await this.prisma.integrationSyncLog.create({
      data: {
        tenantId: input.tenantId,
        runId: input.runId,
        entity: input.entity,
        externalId: input.externalId,
        action: input.action,
        status: input.status,
        message: input.message,
        metadata: input.metadata,
      },
    });
  }

  private nextPagination(
    body: unknown,
    currentPagination?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const root = this.isRecord(body) ? body : {};
    const pagination = this.extractPaginationFromBody(body);
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
    const totalPages =
      this.numberFrom(pagination.pages) ??
      this.numberFrom(pagination.total_pages) ??
      this.numberFrom(pagination.paginas);
    const total =
      this.numberFrom(pagination.total) ??
      this.numberFrom(pagination.count) ??
      this.numberFrom(root.total) ??
      this.numberFrom(root.count);
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
            "O SGP retornou uma página de documentação/HTML em vez da lista de clientes. Verifique SGP_API_URL e o endpoint de clientes.",
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
            "O SGP retornou metadados de documentação em vez da lista de clientes. Verifique SGP_API_URL e o endpoint de clientes.",
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
  ) {
    const result = { created: 0, updated: 0 };

    for (const contract of contracts) {
      const externalId = this.contractExternalId(contract);
      if (!externalId) continue;

      const service = this.firstRecord(contract, ["servico", "serviço", "servicos", "serviços"]);
      const data = {
        customerId,
        status: this.mapContractStatus(contract, service),
        planName: this.extractPlanName(service) ?? this.firstString(contract, ["plano", "plano_nome", "nome_plano"]),
        serviceLogin: this.firstString(service, ["login", "usuario", "usuário", "pppoe"]),
        address: this.mapAddress({}, contract, service),
        metadata: this.toJsonValue({
          source: "SGP",
          importedAt: new Date().toISOString(),
          raw: contract,
        }),
        startedAt: this.parseDate(this.firstString(contract, ["data_inicio", "data_instalacao", "data_ativacao"])),
        endedAt: this.parseDate(this.firstString(contract, ["data_fim", "data_cancelamento"])),
      };
      const existing = await this.prisma.contract.findUnique({
        where: { tenantId_externalId: { tenantId, externalId } },
      });

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
        await this.prisma.contract.create({
          data: {
            tenantId,
            externalId,
            ...data,
          },
        });
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
  ) {
    const result = { created: 0, updated: 0 };

    for (const invoice of invoices) {
      const externalId = this.invoiceExternalId(invoice);
      if (!externalId) continue;

      const contractExternalId = this.firstString(invoice, [
        "contrato",
        "idcontrato",
        "contrato_id",
        "id_contrato",
      ]);
      const contract = contractExternalId
        ? await this.prisma.contract.findUnique({
            where: {
              tenantId_externalId: {
                tenantId,
                externalId: contractExternalId,
              },
            },
          })
        : null;
      const data = {
        customerId,
        contractId: contract?.id,
        status: this.mapInvoiceStatus(invoice),
        amountCents: this.parseMoneyToCents(
          this.firstString(invoice, ["valor", "valor_total", "total", "amount"]),
        ),
        dueDate: this.parseDate(this.firstString(invoice, ["vencimento", "data_vencimento", "dueDate"])),
        paidAt: this.parseDate(this.firstString(invoice, ["pagamento", "data_pagamento", "paidAt"])),
        metadata: this.toJsonValue({
          source: "SGP",
          importedAt: new Date().toISOString(),
          raw: invoice,
        }),
      };
      const existing = await this.prisma.invoice.findUnique({
        where: { tenantId_externalId: { tenantId, externalId } },
      });

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
        await this.prisma.invoice.create({
          data: {
            tenantId,
            externalId,
            ...data,
          },
        });
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
}
