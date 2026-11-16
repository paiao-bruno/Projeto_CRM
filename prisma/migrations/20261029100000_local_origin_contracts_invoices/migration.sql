-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "origin" TEXT,
ALTER COLUMN "externalId" DROP NOT NULL;
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "origin" TEXT,
ALTER COLUMN "externalId" DROP NOT NULL;
