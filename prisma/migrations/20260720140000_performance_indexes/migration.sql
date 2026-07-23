-- Performance indexes for large-scale customer sync and dashboard queries

CREATE INDEX "IntegrationSyncRun_tenantId_operation_status_finishedAt_idx"
  ON "IntegrationSyncRun"("tenantId", "operation", "status", "finishedAt");

CREATE INDEX "IntegrationSyncRun_operation_status_startedAt_idx"
  ON "IntegrationSyncRun"("operation", "status", "startedAt");

CREATE INDEX "Integration_provider_status_idx"
  ON "Integration"("provider", "status");

CREATE INDEX "Conversation_tenantId_activeAiAgentId_status_idx"
  ON "Conversation"("tenantId", "activeAiAgentId", "status");

CREATE INDEX "Message_tenantId_createdAt_idx"
  ON "Message"("tenantId", "createdAt");

CREATE INDEX "Message_tenantId_senderAiAgentId_idx"
  ON "Message"("tenantId", "senderAiAgentId");

CREATE INDEX "Message_tenantId_senderType_createdAt_idx"
  ON "Message"("tenantId", "senderType", "createdAt");

CREATE INDEX "Customer_tenantId_deletedAt_ispAccountCode_idx"
  ON "Customer"("tenantId", "deletedAt", "ispAccountCode");

CREATE INDEX "Customer_tenantId_deletedAt_updatedAt_idx"
  ON "Customer"("tenantId", "deletedAt", "updatedAt");

CREATE INDEX "Contract_tenantId_customerId_deletedAt_idx"
  ON "Contract"("tenantId", "customerId", "deletedAt");

CREATE INDEX "Contract_tenantId_status_deletedAt_idx"
  ON "Contract"("tenantId", "status", "deletedAt");

CREATE INDEX "Invoice_tenantId_customerId_deletedAt_idx"
  ON "Invoice"("tenantId", "customerId", "deletedAt");

CREATE INDEX "Invoice_tenantId_status_deletedAt_idx"
  ON "Invoice"("tenantId", "status", "deletedAt");
