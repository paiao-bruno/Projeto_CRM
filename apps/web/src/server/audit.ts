import type { Prisma, PrismaClient } from "@prisma/client";
import type { ServerAuthUser } from "./auth";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export function recordAudit(
  db: DbClient,
  user: Pick<ServerAuthUser, "tenantId" | "memberId">,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata?: Prisma.InputJsonValue,
) {
  return db.auditLog.create({
    data: { tenantId: user.tenantId, actorMemberId: user.memberId, action, entityType, entityId, metadata },
  });
}
