/**
 * Cadastro local de clientes, contratos e faturas (sem SGP, sem servidor NestJS).
 * Isolamento por organização em toda consulta; exclusão lógica; auditoria nas mutações.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ServerAuthUser } from "./auth";
import { recordAudit } from "./audit";
import { HttpError } from "./http";
import { getPrisma } from "./prisma";
import {
  amountFromBody,
  optionalDate,
  optionalEmail,
  optionalEnum,
  optionalString,
  paged,
  parsePaging,
  requireUuid,
  requiredString,
  stripUndefined,
  type Body,
} from "./validation";

export const CUSTOMER_STATUSES = ["ACTIVE", "INACTIVE", "OVERDUE", "CHURNED", "PROSPECT"] as const;
export const CONTRACT_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "CANCELED", "UNKNOWN"] as const;
export const INVOICE_STATUSES = ["OPEN", "PAID", "OVERDUE", "CANCELED", "UNKNOWN"] as const;

function mapUnique(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new HttpError(409, message);
  }
  throw error;
}

export class RecordsService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /* ------------------------------ clientes ------------------------------ */

  async listCustomers(user: ServerAuthUser, query: URLSearchParams) {
    const { page, limit } = parsePaging(query, 50, 200);
    const search = query.get("search")?.trim();
    const where: Prisma.CustomerWhereInput = {
      tenantId: user.tenantId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
              { document: { contains: search, mode: "insensitive" } },
              { ispAccountCode: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      this.prisma.customer.count({ where }),
    ]);
    return paged(data, total, page, limit);
  }

  async getCustomer(user: ServerAuthUser, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: requireUuid(id), tenantId: user.tenantId, deletedAt: null },
      include: {
        contacts: true,
        conversations: { orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, protocol: true, status: true, lastMessageAt: true } },
        _count: { select: { contracts: { where: { deletedAt: null } }, invoices: { where: { deletedAt: null } } } },
      },
    });
    if (!customer) throw new HttpError(404, "Cliente não encontrado.");
    return customer;
  }

  async createCustomer(user: ServerAuthUser, body: Body) {
    const data = {
      name: requiredString(body, "name", 160),
      document: optionalString(body, "document", 32) ?? undefined,
      email: optionalEmail(body, "email") ?? undefined,
      phone: optionalString(body, "phone", 40) ?? undefined,
      planName: optionalString(body, "planName", 120) ?? undefined,
      status: optionalEnum(body, "status", CUSTOMER_STATUSES) ?? "PROSPECT",
    };
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: { ...data, tenantId: user.tenantId, ownerMemberId: user.memberId, metadata: { origin: "LOCAL" } },
        });
        await recordAudit(tx, user, "customer.created", "Customer", customer.id);
        return customer;
      });
      return created;
    } catch (error) {
      return mapUnique(error, "Já existe um cliente com este documento.");
    }
  }

  async updateCustomer(user: ServerAuthUser, id: string, body: Body) {
    await this.getCustomer(user, id);
    const data = stripUndefined({
      name: body.name === undefined ? undefined : requiredString(body, "name", 160),
      document: optionalString(body, "document", 32),
      email: optionalEmail(body, "email"),
      phone: optionalString(body, "phone", 40),
      planName: optionalString(body, "planName", 120),
      status: optionalEnum(body, "status", CUSTOMER_STATUSES),
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.customer.update({ where: { id }, data });
        await recordAudit(tx, user, "customer.updated", "Customer", id, { fields: Object.keys(data) });
        return updated;
      });
    } catch (error) {
      return mapUnique(error, "Já existe um cliente com este documento.");
    }
  }

  async removeCustomer(user: ServerAuthUser, id: string) {
    await this.getCustomer(user, id);
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.customer.update({ where: { id }, data: { deletedAt: now } });
      await tx.contract.updateMany({ where: { tenantId: user.tenantId, customerId: id, deletedAt: null }, data: { deletedAt: now } });
      await tx.invoice.updateMany({ where: { tenantId: user.tenantId, customerId: id, deletedAt: null }, data: { deletedAt: now } });
      await recordAudit(tx, user, "customer.deleted", "Customer", id, { soft: true });
    });
    return { deleted: true, id };
  }

  /* ------------------------------ contratos ------------------------------ */

  private async assertCustomer(user: ServerAuthUser, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId: user.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new HttpError(422, "Cliente inexistente nesta organização.");
  }

  async listContracts(user: ServerAuthUser, query: URLSearchParams, customerId?: string) {
    const { page, limit } = parsePaging(query, 50, 200);
    const status = optionalEnum({ s: query.get("status") ?? undefined }, "s", CONTRACT_STATUSES);
    const search = query.get("search")?.trim();
    const where: Prisma.ContractWhereInput = {
      tenantId: user.tenantId,
      deletedAt: null,
      ...(customerId ?? query.get("customerId") ? { customerId: requireUuid(customerId ?? query.get("customerId"), "customerId") } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? { OR: [{ planName: { contains: search, mode: "insensitive" } }, { serviceLogin: { contains: search, mode: "insensitive" } }, { customer: { name: { contains: search, mode: "insensitive" } } }] }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: { customer: { select: { id: true, name: true } } },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return paged(data, total, page, limit);
  }

  async getContract(user: ServerAuthUser, id: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: requireUuid(id), tenantId: user.tenantId, deletedAt: null },
      include: { customer: { select: { id: true, name: true } } },
    });
    if (!contract) throw new HttpError(404, "Contrato não encontrado.");
    return contract;
  }

  async createContract(user: ServerAuthUser, body: Body) {
    const customerId = requireUuid(body.customerId, "customerId");
    await this.assertCustomer(user, customerId);
    const created = await this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.create({
        data: {
          tenantId: user.tenantId,
          customerId,
          origin: "LOCAL",
          status: optionalEnum(body, "status", CONTRACT_STATUSES) ?? "ACTIVE",
          planName: optionalString(body, "planName", 120) ?? undefined,
          serviceLogin: optionalString(body, "serviceLogin", 120) ?? undefined,
          startedAt: optionalDate(body, "startedAt") ?? undefined,
          endedAt: optionalDate(body, "endedAt") ?? undefined,
        },
      });
      await recordAudit(tx, user, "contract.created", "Contract", contract.id, { customerId });
      return contract;
    });
    return created;
  }

  async updateContract(user: ServerAuthUser, id: string, body: Body) {
    await this.getContract(user, id);
    const data = stripUndefined({
      status: optionalEnum(body, "status", CONTRACT_STATUSES),
      planName: optionalString(body, "planName", 120),
      serviceLogin: optionalString(body, "serviceLogin", 120),
      startedAt: optionalDate(body, "startedAt"),
      endedAt: optionalDate(body, "endedAt"),
    });
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contract.update({ where: { id }, data });
      await recordAudit(tx, user, "contract.updated", "Contract", id, { fields: Object.keys(data) });
      return updated;
    });
  }

  async removeContract(user: ServerAuthUser, id: string) {
    await this.getContract(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.contract.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.invoice.updateMany({ where: { tenantId: user.tenantId, contractId: id }, data: { contractId: null } });
      await recordAudit(tx, user, "contract.deleted", "Contract", id, { soft: true });
    });
    return { deleted: true, id };
  }

  /* ------------------------------- faturas ------------------------------- */

  async listInvoices(user: ServerAuthUser, query: URLSearchParams, customerId?: string) {
    const { page, limit } = parsePaging(query, 50, 200);
    const status = optionalEnum({ s: query.get("status") ?? undefined }, "s", INVOICE_STATUSES);
    const where: Prisma.InvoiceWhereInput = {
      tenantId: user.tenantId,
      deletedAt: null,
      ...(customerId ?? query.get("customerId") ? { customerId: requireUuid(customerId ?? query.get("customerId"), "customerId") } : {}),
      ...(query.get("contractId") ? { contractId: requireUuid(query.get("contractId"), "contractId") } : {}),
      ...(status ? { status } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { customer: { select: { id: true, name: true } } },
        orderBy: [{ dueDate: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return paged(data, total, page, limit);
  }

  async getInvoice(user: ServerAuthUser, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: requireUuid(id), tenantId: user.tenantId, deletedAt: null },
      include: { customer: { select: { id: true, name: true } } },
    });
    if (!invoice) throw new HttpError(404, "Fatura não encontrada.");
    return invoice;
  }

  private async assertContractOf(user: ServerAuthUser, contractId: string, customerId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId: user.tenantId, deletedAt: null },
      select: { customerId: true },
    });
    if (!contract) throw new HttpError(422, "Contrato inexistente nesta organização.");
    if (contract.customerId !== customerId) throw new HttpError(422, "O contrato pertence a outro cliente.");
  }

  async createInvoice(user: ServerAuthUser, body: Body) {
    const customerId = requireUuid(body.customerId, "customerId");
    await this.assertCustomer(user, customerId);
    const contractId = body.contractId ? requireUuid(body.contractId, "contractId") : undefined;
    if (contractId) await this.assertContractOf(user, contractId, customerId);
    const amountCents = amountFromBody(body);
    if (amountCents === undefined || amountCents === null) throw new HttpError(422, "amount é obrigatório.");
    const status = optionalEnum(body, "status", INVOICE_STATUSES) ?? "OPEN";
    const paidAt = optionalDate(body, "paidAt") ?? (status === "PAID" ? new Date() : undefined);
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          tenantId: user.tenantId,
          customerId,
          contractId,
          origin: "LOCAL",
          status,
          amountCents,
          dueDate: optionalDate(body, "dueDate") ?? undefined,
          paidAt,
        },
      });
      await recordAudit(tx, user, "invoice.created", "Invoice", invoice.id, { customerId, amountCents });
      return invoice;
    });
  }

  async updateInvoice(user: ServerAuthUser, id: string, body: Body) {
    const current = await this.getInvoice(user, id);
    const status = optionalEnum(body, "status", INVOICE_STATUSES);
    const contractId = body.contractId === undefined ? undefined : body.contractId === null ? null : requireUuid(body.contractId, "contractId");
    if (contractId) await this.assertContractOf(user, contractId, current.customerId);
    const amountCents = amountFromBody(body);
    const data = stripUndefined({
      status,
      contractId,
      amountCents,
      dueDate: optionalDate(body, "dueDate"),
      paidAt: optionalDate(body, "paidAt") ?? (status === "PAID" && !current.paidAt ? new Date() : status && status !== "PAID" ? null : undefined),
    });
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({ where: { id }, data });
      await recordAudit(tx, user, "invoice.updated", "Invoice", id, { fields: Object.keys(data) });
      return updated;
    });
  }

  async removeInvoice(user: ServerAuthUser, id: string) {
    await this.getInvoice(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id }, data: { deletedAt: new Date() } });
      await recordAudit(tx, user, "invoice.deleted", "Invoice", id, { soft: true });
    });
    return { deleted: true, id };
  }
}

let singleton: RecordsService | null = null;
export function getRecordsService() {
  singleton ??= new RecordsService();
  return singleton;
}
