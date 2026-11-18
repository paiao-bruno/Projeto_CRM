-- Etapa Sucesso: confirmação auditável de primeiro pagamento qualificável (aditiva).
-- Não promove oportunidades em Ativação automaticamente.

CREATE TABLE "DealPaymentConfirmation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "invoiceId" UUID,
    "source" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "actorMemberId" UUID,
    "reversedAt" TIMESTAMP(3),
    "reversedByMemberId" UUID,
    "reverseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealPaymentConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DealPaymentConfirmation_tenantId_dealId_createdAt_idx" ON "DealPaymentConfirmation"("tenantId", "dealId", "createdAt");
CREATE INDEX "DealPaymentConfirmation_tenantId_invoiceId_idx" ON "DealPaymentConfirmation"("tenantId", "invoiceId");
CREATE INDEX "DealPaymentConfirmation_dealId_reversedAt_idx" ON "DealPaymentConfirmation"("dealId", "reversedAt");

ALTER TABLE "DealPaymentConfirmation" ADD CONSTRAINT "DealPaymentConfirmation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DealPaymentConfirmation" ADD CONSTRAINT "DealPaymentConfirmation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DealPaymentConfirmation" ADD CONSTRAINT "DealPaymentConfirmation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DealPaymentConfirmation" ADD CONSTRAINT "DealPaymentConfirmation_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "TenantMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DealPaymentConfirmation" ADD CONSTRAINT "DealPaymentConfirmation_reversedByMemberId_fkey" FOREIGN KEY ("reversedByMemberId") REFERENCES "TenantMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
