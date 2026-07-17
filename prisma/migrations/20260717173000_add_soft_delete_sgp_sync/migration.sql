ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Customer_tenantId_deletedAt_idx" ON "Customer"("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "Contract_tenantId_deletedAt_idx" ON "Contract"("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "Invoice_tenantId_deletedAt_idx" ON "Invoice"("tenantId", "deletedAt");
