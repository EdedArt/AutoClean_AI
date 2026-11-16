-- AlterTable
ALTER TABLE "Package" ADD COLUMN "codigo" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Package_codigo_key" ON "Package"("codigo");

-- Backfill stable codes for the seeded packages (clients translate by codigo)
UPDATE "Package" SET "codigo" = 'BASICO' WHERE "nombre" = 'Lavado Básico' AND "codigo" IS NULL;
UPDATE "Package" SET "codigo" = 'PROFUNDO_POLICHADO' WHERE "nombre" = 'Lavado Profundo + Polichado' AND "codigo" IS NULL;
