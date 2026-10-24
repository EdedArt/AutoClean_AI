-- CreateTable
CREATE TABLE "SearchedPlate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "placa" TEXT NOT NULL,
    "lastSearchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchedPlate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SearchedPlate_userId_lastSearchedAt_idx" ON "SearchedPlate"("userId", "lastSearchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SearchedPlate_userId_placa_key" ON "SearchedPlate"("userId", "placa");
