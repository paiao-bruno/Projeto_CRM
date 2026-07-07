import { BadGatewayException, Injectable } from "@nestjs/common";
import { CustomerStatus } from "@prisma/client";
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
      request.endpoint,
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

    const candidateKeys = [
      "clientes",
      "cliente",
      "data",
      "results",
      "registros",
      "objects",
      "items",
    ];

    for (const key of candidateKeys) {
      const value = body[key];
      if (Array.isArray(value)) {
        return value.filter(this.isRecord);
      }
      if (this.isRecord(value)) {
        return [value];
      }
    }

    return this.looksLikeCustomer(body) ? [body] : [];
  }

  private mapSgpCustomer(raw: Record<string, unknown>): ExternalCustomerInput {
    const externalId = this.firstString(raw, [
      "id",
      "cliente_id",
      "idcliente",
      "codigo",
      "codcli",
      "cod_cliente",
      "contrato",
      "idcontrato",
    ]);
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
    ]);

    return {
      externalId,
      name,
      document,
      email,
      phone,
      planName,
      status: this.mapCustomerStatus(raw),
      address: this.mapAddress(raw),
      metadata: {
        source: "SGP",
        importedAt: new Date().toISOString(),
        externalId,
      },
    };
  }

  private mapCustomerStatus(raw: Record<string, unknown>) {
    const status = String(
      this.firstString(raw, ["status", "situacao", "situação", "ativo"]) ?? "",
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

  private mapAddress(raw: Record<string, unknown>) {
    const address = {
      street: this.firstString(raw, ["endereco", "logradouro", "rua"]),
      number: this.firstString(raw, ["numero", "número", "num"]),
      district: this.firstString(raw, ["bairro"]),
      city: this.firstString(raw, ["cidade", "city"]),
      state: this.firstString(raw, ["uf", "estado", "state"]),
      zipCode: this.firstString(raw, ["cep", "zipcode"]),
      complement: this.firstString(raw, ["complemento", "referencia"]),
    };
    const hasValue = Object.values(address).some(Boolean);
    return hasValue ? address : undefined;
  }

  private firstString(
    raw: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
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
