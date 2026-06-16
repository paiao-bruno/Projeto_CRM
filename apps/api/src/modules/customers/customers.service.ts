import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";

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
}
