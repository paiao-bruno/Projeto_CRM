import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, customerId?: string) {
    return this.prisma.invoice.findMany({
      where: {
        tenantId,
        ...(customerId ? { customerId } : {}),
      },
      include: {
        customer: true,
        contract: true,
      },
      orderBy: [{ dueDate: "desc" }, { updatedAt: "desc" }],
      take: 100,
    });
  }
}
