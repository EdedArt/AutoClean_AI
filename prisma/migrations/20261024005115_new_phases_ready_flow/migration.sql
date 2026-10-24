-- CreateTable
CREATE TABLE "PhaseEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "fase" TEXT NOT NULL,
    "progreso" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhaseEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ServiceOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vehicleId" INTEGER NOT NULL,
    "packageId" INTEGER,
    "bayId" INTEGER,
    "faseActual" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "porcentajeProgreso" INTEGER NOT NULL DEFAULT 10,
    "listoParaLavar" BOOLEAN NOT NULL DEFAULT false,
    "readyAt" DATETIME,
    "horaEstimadaEntrega" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceOrder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceOrder_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ServiceOrder_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES "Bay" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ServiceOrder" ("bayId", "createdAt", "faseActual", "horaEstimadaEntrega", "id", "packageId", "porcentajeProgreso", "updatedAt", "vehicleId") SELECT "bayId", "createdAt", "faseActual", "horaEstimadaEntrega", "id", "packageId", "porcentajeProgreso", "updatedAt", "vehicleId" FROM "ServiceOrder";
DROP TABLE "ServiceOrder";
ALTER TABLE "new_ServiceOrder" RENAME TO "ServiceOrder";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PhaseEvent_orderId_idx" ON "PhaseEvent"("orderId");

-- Data Migration: Update RECIBIDO to PENDIENTE
UPDATE "ServiceOrder" SET "faseActual" = 'PENDIENTE' WHERE "faseActual" = 'RECIBIDO';
UPDATE "Evidence" SET "etapa" = 'PENDIENTE' WHERE "etapa" = 'RECIBIDO';

-- Data Migration: Update porcentajeProgreso to match new phase map
UPDATE "ServiceOrder" SET "porcentajeProgreso" = 10 WHERE "faseActual" = 'PENDIENTE';
UPDATE "ServiceOrder" SET "porcentajeProgreso" = 30 WHERE "faseActual" = 'REMOJO';
UPDATE "ServiceOrder" SET "porcentajeProgreso" = 55 WHERE "faseActual" = 'LAVADO';
UPDATE "ServiceOrder" SET "porcentajeProgreso" = 80 WHERE "faseActual" = 'SECADO';
UPDATE "ServiceOrder" SET "porcentajeProgreso" = 100 WHERE "faseActual" = 'LISTO';

-- Data Migration: Set listoParaLavar = true for existing orders whose phase is not PENDIENTE
UPDATE "ServiceOrder" SET "listoParaLavar" = true WHERE "faseActual" != 'PENDIENTE';

-- Data Migration: Backfill ONE PhaseEvent per existing order with its current phase, source 'MANUAL'
INSERT INTO "PhaseEvent" ("orderId", "fase", "progreso", "source", "createdAt")
SELECT "id", "faseActual", "porcentajeProgreso", 'MANUAL', CURRENT_TIMESTAMP FROM "ServiceOrder";

