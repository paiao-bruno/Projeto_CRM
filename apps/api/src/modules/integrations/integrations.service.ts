import { BadGatewayException, Injectable } from "@nestjs/common";
import { CustomerStatus, Prisma } from "@prisma/client";
import {
  CustomersService,
  ExternalCustomerInput,
} from "../customers/customers.service";
import { AuthUser } from "../auth/types/auth-user";
import { SgpClientService } from "./sgp/sgp-client.service";
import { SgpDiscoveryRequest } from "./sgp/types/sgp-client.types";

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly sgpClient: SgpClientService,
    private readonly customersService: CustomersService,
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
    const result = {
      processed: rawCustomers.length,
      created: 0,
      updated: 0,
      ignored: 0,
      errors: [] as Array<{ index: number; message: string }>,
    };

    for (const [index, rawCustomer] of rawCustomers.entries()) {
      try {
        const mappedCustomer = this.mapSgpCustomer(rawCustomer);

        if (!mappedCustomer.externalId && !mappedCustomer.document) {
          result.ignored += 1;
          result.errors.push({
            index,
            message:
              "Cliente ignorado porque não possui CPF/CNPJ nem identificador externo.",
          });
          continue;
        }

        const upsert = await this.customersService.upsertFromExternalSource(
          user.tenantId,
          user.memberId,
          mappedCustomer,
        );

        if (upsert.operation === "created") {
          result.created += 1;
        } else {
          result.updated += 1;
        }
      } catch (error) {
        result.ignored += 1;
        result.errors.push({
          index,
          message: error instanceof Error ? error.message : "Erro inesperado.",
        });
      }
    }

    return result;
  }

  async debugSgp(request: SgpDiscoveryRequest) {
    const response = await this.sgpClient.debug(
      request.endpoint ?? "/",
      request.payload,
    );
    return response.body;
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

  private mapSgpCustomer(raw: Record<string, unknown>): ExternalCustomerInput {
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
        contratos: this.toJsonValue(raw.__sgpContratos),
        titulos: this.toJsonValue(raw.__sgpTitulos),
        pagination: this.toJsonValue(raw.__sgpPagination),
      },
    };
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
