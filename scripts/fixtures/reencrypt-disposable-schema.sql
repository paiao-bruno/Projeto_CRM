-- Schema mínimo descartável para teste de re-criptografia SGP.
-- Compatível com nomes/colunas do Prisma; sem extensão vector.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELED');
CREATE TYPE "IntegrationProvider" AS ENUM ('WHATSAPP', 'WEBHOOK', 'EXTERNAL_API', 'SGP', 'OPENAI', 'ANTHROPIC', 'GOOGLE', 'STORAGE', 'EMAIL');
CREATE TYPE "IntegrationStatus" AS ENUM ('DRAFT', 'CONNECTING', 'ACTIVE', 'DEGRADED', 'DISCONNECTED', 'ERROR', 'DISABLED');
CREATE TYPE "HealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'WARNING', 'DOWN');
CREATE TYPE "CustomerStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'CANCELED');
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'CANCELED', 'UNKNOWN');
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'OVERDUE', 'CANCELED', 'UNKNOWN');
CREATE TYPE "IntegrationSyncStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL', 'SKIPPED');
CREATE TYPE "IntegrationSyncEntity" AS ENUM ('CUSTOMER', 'CONTRACT', 'INVOICE');

CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "document" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

CREATE TABLE "Integration" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DRAFT',
    "healthStatus" "HealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "config" JSONB,
    "encryptedSecrets" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Integration_tenantId_provider_name_key" ON "Integration"("tenantId", "provider", "name");
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ownerMemberId" UUID,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'PROSPECT',
    "ispAccountCode" TEXT,
    "planName" TEXT,
    "address" JSONB,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Contract" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'UNKNOWN',
    "planName" TEXT,
    "serviceLogin" TEXT,
    "address" JSONB,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "contractId" UUID,
    "externalId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "amountCents" INTEGER,
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "IntegrationSyncRun" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "integrationId" UUID,
    "triggeredById" UUID,
    "operation" TEXT NOT NULL,
    "status" "IntegrationSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "syncMode" TEXT,
    "trigger" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "ignored" INTEGER NOT NULL DEFAULT 0,
    "errorsCount" INTEGER NOT NULL DEFAULT 0,
    "customersProcessed" INTEGER NOT NULL DEFAULT 0,
    "customersCreated" INTEGER NOT NULL DEFAULT 0,
    "customersUpdated" INTEGER NOT NULL DEFAULT 0,
    "customersDeleted" INTEGER NOT NULL DEFAULT 0,
    "customersIgnored" INTEGER NOT NULL DEFAULT 0,
    "contractsProcessed" INTEGER NOT NULL DEFAULT 0,
    "contractsCreated" INTEGER NOT NULL DEFAULT 0,
    "contractsUpdated" INTEGER NOT NULL DEFAULT 0,
    "contractsDeleted" INTEGER NOT NULL DEFAULT 0,
    "contractsIgnored" INTEGER NOT NULL DEFAULT 0,
    "invoicesProcessed" INTEGER NOT NULL DEFAULT 0,
    "invoicesCreated" INTEGER NOT NULL DEFAULT 0,
    "invoicesUpdated" INTEGER NOT NULL DEFAULT 0,
    "invoicesDeleted" INTEGER NOT NULL DEFAULT 0,
    "invoicesIgnored" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "stackTrace" TEXT,
    "cursor" JSONB,
    "errorMessage" TEXT,
    "metadata" JSONB,
    CONSTRAINT "IntegrationSyncRun_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "IntegrationSyncRun" ADD CONSTRAINT "IntegrationSyncRun_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationSyncRun" ADD CONSTRAINT "IntegrationSyncRun_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "IntegrationSyncLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "entity" "IntegrationSyncEntity" NOT NULL,
    "externalId" TEXT,
    "action" TEXT NOT NULL,
    "status" "IntegrationSyncStatus" NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntegrationSyncLog_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "IntegrationSyncLog" ADD CONSTRAINT "IntegrationSyncLog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationSyncLog" ADD CONSTRAINT "IntegrationSyncLog_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "IntegrationSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "_prisma_migrations" (
    "id" VARCHAR(36) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);

INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "applied_steps_count")
VALUES
  ('disposable-init', 'disposable', NOW(), '20260708160000_init', NULL, 1),
  ('disposable-perf', 'disposable', NOW(), '20260720140000_performance_indexes', NULL, 1);
