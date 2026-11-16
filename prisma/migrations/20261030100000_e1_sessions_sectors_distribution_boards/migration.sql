-- E1: sessões revogáveis, recuperação de acesso, setores, rodízio e Quadro Ao Vivo (aditiva).
-- AlterTable
ALTER TABLE "AuthSession" ALTER COLUMN "refreshTokenHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "closedByMemberId" UUID,
ADD COLUMN     "firstResponseAt" TIMESTAMP(3),
ADD COLUMN     "sectorId" UUID;

-- AlterTable
ALTER TABLE "TenantMember" ADD COLUMN     "maxActiveConversations" INTEGER;

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "issuedByMemberId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectorCategory" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SectorCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sector" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "categoryId" UUID,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b5bfd',
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "workingHours" JSONB,
    "greeting" TEXT,
    "outOfHoursMessage" TEXT,
    "requireCloseReason" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectorMember" (
    "sectorId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectorMember_pkey" PRIMARY KEY ("sectorId","memberId")
);

-- CreateTable
CREATE TABLE "RoundRobinRule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sectorId" UUID NOT NULL,
    "fallbackSectorId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "cycleNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoundRobinRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundRobinParticipant" (
    "ruleId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "percent" INTEGER NOT NULL,
    "assignedInCycle" INTEGER NOT NULL DEFAULT 0,
    "totalAssigned" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RoundRobinParticipant_pkey" PRIMARY KEY ("ruleId","memberId")
);

-- CreateTable
CREATE TABLE "ConversationBoard" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardColumn" (
    "id" UUID NOT NULL,
    "boardId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardCard" (
    "id" UUID NOT NULL,
    "boardId" UUID NOT NULL,
    "columnId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SectorCategory_tenantId_name_key" ON "SectorCategory"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Sector_tenantId_active_position_idx" ON "Sector"("tenantId", "active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Sector_tenantId_name_key" ON "Sector"("tenantId", "name");

-- CreateIndex
CREATE INDEX "SectorMember_tenantId_memberId_idx" ON "SectorMember"("tenantId", "memberId");

-- CreateIndex
CREATE INDEX "RoundRobinRule_tenantId_sectorId_active_idx" ON "RoundRobinRule"("tenantId", "sectorId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationBoard_tenantId_name_key" ON "ConversationBoard"("tenantId", "name");

-- CreateIndex
CREATE INDEX "BoardColumn_boardId_position_idx" ON "BoardColumn"("boardId", "position");

-- CreateIndex
CREATE INDEX "BoardCard_columnId_position_idx" ON "BoardCard"("columnId", "position");

-- CreateIndex
CREATE INDEX "BoardCard_tenantId_conversationId_idx" ON "BoardCard"("tenantId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardCard_boardId_conversationId_key" ON "BoardCard"("boardId", "conversationId");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_sectorId_status_idx" ON "Conversation"("tenantId", "sectorId", "status");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_createdAt_idx" ON "Conversation"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_closedAt_idx" ON "Conversation"("tenantId", "closedAt");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectorCategory" ADD CONSTRAINT "SectorCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SectorCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectorMember" ADD CONSTRAINT "SectorMember_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectorMember" ADD CONSTRAINT "SectorMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TenantMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundRobinRule" ADD CONSTRAINT "RoundRobinRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundRobinRule" ADD CONSTRAINT "RoundRobinRule_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundRobinRule" ADD CONSTRAINT "RoundRobinRule_fallbackSectorId_fkey" FOREIGN KEY ("fallbackSectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundRobinParticipant" ADD CONSTRAINT "RoundRobinParticipant_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "RoundRobinRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundRobinParticipant" ADD CONSTRAINT "RoundRobinParticipant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TenantMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationBoard" ADD CONSTRAINT "ConversationBoard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardColumn" ADD CONSTRAINT "BoardColumn_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "ConversationBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardCard" ADD CONSTRAINT "BoardCard_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "ConversationBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardCard" ADD CONSTRAINT "BoardCard_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "BoardColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardCard" ADD CONSTRAINT "BoardCard_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Novas permissões; concedidas a papéis que já administram o CRM (crm.manage) para não bloquear administradores existentes.
INSERT INTO "Permission" (id, code, description, "createdAt")
SELECT gen_random_uuid(), p.code, p.code, NOW()
FROM (VALUES ('team.manage'), ('audit.read'), ('reports.read')) AS p(code)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId", "createdAt")
SELECT rp."roleId", np.id, NOW()
FROM "RolePermission" rp
JOIN "Permission" cm ON cm.id = rp."permissionId" AND cm.code = 'crm.manage'
JOIN "Permission" np ON np.code IN ('team.manage', 'audit.read', 'reports.read')
ON CONFLICT DO NOTHING;
