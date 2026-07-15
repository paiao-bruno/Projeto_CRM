import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, customerId?: string, page = 1, limit = 100) {
    const where = {
      tenantId,
      ...(customerId ? { customerId } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: {
          customer: true,
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contract.count({ where }),
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
