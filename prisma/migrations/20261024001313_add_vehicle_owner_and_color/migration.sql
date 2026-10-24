-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Vehicle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "placa" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'Sin especificar',
    "ownerName" TEXT NOT NULL DEFAULT 'Sin especificar',
    "ownerId" INTEGER,
    "nivelSuciedad" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Vehicle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Vehicle" ("createdAt", "id", "marca", "modelo", "nivelSuciedad", "placa") SELECT "createdAt", "id", "marca", "modelo", "nivelSuciedad", "placa" FROM "Vehicle";
DROP TABLE "Vehicle";
ALTER TABLE "new_Vehicle" RENAME TO "Vehicle";
CREATE UNIQUE INDEX "Vehicle_placa_key" ON "Vehicle"("placa");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
