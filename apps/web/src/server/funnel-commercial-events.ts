import type { Prisma } from "@prisma/client";
import { SALES_FUNNEL_STAGE_CODES } from "../../../../shared/sales-funnel.constants";

type Tx = Prisma.TransactionClient;

export async function recordDealConversion(
  tx: Tx,
  input: { tenantId: string; dealId: string; customerId?: string | null; occurredAt?: Date },
) {
  const existing = await tx.funnelCommercialEvent.findFirst({
    where: { tenantId: input.tenantId, type: "CONVERSION", dealId: input.dealId },
    select: { id: true },
  });
  if (existing) return existing;
  return tx.funnelCommercialEvent.create({
    data: {
      tenantId: input.tenantId,
      type: "CONVERSION",
      dealId: input.dealId,
      customerId: input.customerId ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      metadata: { source: "funnel_success" },
    },
  });
}

export async function recordCustomerCancellation(
  tx: Tx,
  input: { tenantId: string; customerId: string; occurredAt?: Date },
) {
  const converted = await tx.funnelCommercialEvent.findFirst({
    where: { tenantId: input.tenantId, type: "CONVERSION", customerId: input.customerId },
    select: { id: true },
  });
  if (!converted) return null;
  const existing = await tx.funnelCommercialEvent.findFirst({
    where: { tenantId: input.tenantId, type: "CANCELLATION", customerId: input.customerId },
    select: { id: true },
  });
  if (existing) return existing;
  return tx.funnelCommercialEvent.create({
    data: {
      tenantId: input.tenantId,
      type: "CANCELLATION",
      customerId: input.customerId,
      occurredAt: input.occurredAt ?? new Date(),
      metadata: { source: "customer_status_churned" },
    },
  });
}

export const ACTIVATION_STAGE_CODE = SALES_FUNNEL_STAGE_CODES.ATIVACAO;
