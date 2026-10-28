-- CreateTable
CREATE TABLE "OutboundDelivery" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "integrationId" UUID,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "name" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "info" JSONB,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboundDelivery_messageId_key" ON "OutboundDelivery"("messageId");

-- CreateIndex
CREATE INDEX "OutboundDelivery_status_nextAttemptAt_idx" ON "OutboundDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboundDelivery_tenantId_status_idx" ON "OutboundDelivery"("tenantId", "status");

-- CreateIndex
CREATE INDEX "OutboundDelivery_integrationId_providerMessageId_idx" ON "OutboundDelivery"("integrationId", "providerMessageId");

-- AddForeignKey
ALTER TABLE "OutboundDelivery" ADD CONSTRAINT "OutboundDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDelivery" ADD CONSTRAINT "OutboundDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDelivery" ADD CONSTRAINT "OutboundDelivery_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
