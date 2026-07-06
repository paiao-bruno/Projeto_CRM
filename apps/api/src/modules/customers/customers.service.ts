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

  list(tenantId: string, search?: string) {
    return this.prisma.customer.findMany({
      where: {
        tenantId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search, mode: "insensitive" } },
                { document: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
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
