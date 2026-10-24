-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "plateDetected" TEXT,
    "plateMatched" BOOLEAN NOT NULL,
    "phaseDetected" TEXT,
    "confidence" REAL,
    "outcome" TEXT NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiAnalysis_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiAnalysis_orderId_idx" ON "AiAnalysis"("orderId");
