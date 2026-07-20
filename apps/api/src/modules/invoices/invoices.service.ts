import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, customerId?: string, page = 1, limit = 100) {
    const where = {
      tenantId,
      deletedAt: null,
      ...(customerId ? { customerId } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        select: {
          id: true,
          tenantId: true,
          customerId: true,
          contractId: true,
          externalId: true,
          status: true,
          amountCents: true,
          dueDate: true,
          paidAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ dueDate: "desc" }, { updatedAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }
}
