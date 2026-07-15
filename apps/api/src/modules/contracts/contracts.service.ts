import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, customerId?: string, limit = 2000) {
    return this.prisma.contract.findMany({
      where: {
        tenantId,
        ...(customerId ? { customerId } : {}),
      },
      include: {
        customer: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
  }
}
