-- AlterTable
ALTER TABLE "ServiceOrder" ADD COLUMN "deliveredAt" DATETIME;

-- Data Migration: Backfill existing finished orders as delivered
UPDATE "ServiceOrder" SET "deliveredAt" = "updatedAt" WHERE "faseActual" = 'LISTO';

