import { Injectable, NotFoundException } from "@nestjs/common";
import { CustomerStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";

export type ExternalCustomerInput = {
  externalId?: string;
  name: string;
  document?: string;
  email?: string;
  phone?: string;
  status?: CustomerStatus;
  planName?: string;
  address?: Prisma.InputJsonObject;
  metadata?: Prisma.InputJsonObject;
};

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, search?: string, page = 1, limit = 100) {
    const where = {
      tenantId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search, mode: "insensitive" as const } },
              { document: { contains: search, mode: "insensitive" as const } },
              { ispAccountCode: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async get(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: {
        contacts: true,
        conversations: {
          orderBy: { updatedAt: "desc" },
          take: 5,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException("Cliente nao encontrado.");
    }

    return customer;
  }

  create(tenantId: string, ownerMemberId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        tenantId,
        ownerMemberId,
        name: dto.name,
        document: dto.document,
        email: dto.email,
        phone: dto.phone,
        status: dto.status ?? "PROSPECT",
        planName: dto.planName,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    await this.get(tenantId, id);

    return this.prisma.customer.update({
      where: { id },
      data: dto,
    });
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);

    return this.prisma.customer.delete({
      where: { id },
    });
  }

  async listContracts(tenantId: string, id: string) {
    await this.get(tenantId, id);

    return this.prisma.contract.findMany({
      where: { tenantId, customerId: id },
      orderBy: { updatedAt: "desc" },
    });
  }

  async listInvoices(tenantId: string, id: string) {
    await this.get(tenantId, id);

    return this.prisma.invoice.findMany({
      where: { tenantId, customerId: id },
      include: { contract: true },
      orderBy: [{ dueDate: "desc" }, { updatedAt: "desc" }],
    });
  }

  async upsertFromExternalSource(
    tenantId: string,
    ownerMemberId: string,
    input: ExternalCustomerInput,
  ) {
    const existing = await this.prisma.customer.findFirst({
      where: {
        tenantId,
        OR: [
          ...(input.externalId ? [{ ispAccountCode: input.externalId }] : []),
          ...(input.document ? [{ document: input.document }] : []),
        ],
      },
    });

    const data = {
      ownerMemberId,
      name: input.name,
      document: input.document,
      email: input.email,
      phone: input.phone,
      status: input.status ?? CustomerStatus.PROSPECT,
      ispAccountCode: input.externalId,
      planName: input.planName,
      address: input.address,
      metadata: input.metadata,
    };

    if (existing) {
      return {
        operation: "updated" as const,
        customer: await this.prisma.customer.update({
          where: { id: existing.id },
          data,
        }),
      };
    }

    return {
      operation: "created" as const,
      customer: await this.prisma.customer.create({
        data: {
          tenantId,
          ...data,
        },
      }),
    };
  }
}
