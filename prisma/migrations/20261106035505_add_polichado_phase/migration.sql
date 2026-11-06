-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Package" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "precio" REAL,
    "incluyePolichado" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Package" ("descripcion", "id", "nombre", "precio") SELECT "descripcion", "id", "nombre", "precio" FROM "Package";
DROP TABLE "Package";
ALTER TABLE "new_Package" RENAME TO "Package";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
