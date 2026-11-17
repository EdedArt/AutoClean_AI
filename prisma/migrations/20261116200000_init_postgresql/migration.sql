-- CreateTable
CREATE TABLE "Vehicle" (
    "id" SERIAL NOT NULL,
    "placa" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'Sin especificar',
    "ownerName" TEXT NOT NULL DEFAULT 'Sin especificar',
    "ownerId" INTEGER,
    "nivelSuciedad" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bay" (
    "id" SERIAL NOT NULL,
    "numero" INTEGER NOT NULL,
    "ocupada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Bay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "precio" DOUBLE PRECISION,
    "incluyePolichado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceOrder" (
    "id" SERIAL NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "packageId" INTEGER,
    "bayId" INTEGER,
    "faseActual" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "porcentajeProgreso" INTEGER NOT NULL DEFAULT 10,
    "listoParaLavar" BOOLEAN NOT NULL DEFAULT false,
    "readyAt" TIMESTAMP(3),
    "horaEstimadaEntrega" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseEvent" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "fase" TEXT NOT NULL,
    "progreso" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "plateDetected" TEXT,
    "plateMatched" BOOLEAN NOT NULL,
    "phaseDetected" TEXT,
    "confidence" DOUBLE PRECISION,
    "outcome" TEXT NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "etapa" TEXT NOT NULL,
    "serviceOrderId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchedPlate" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "placa" TEXT NOT NULL,
    "lastSearchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchedPlate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_placa_key" ON "Vehicle"("placa");

-- CreateIndex
CREATE INDEX "Vehicle_ownerId_idx" ON "Vehicle"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Bay_numero_key" ON "Bay"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Package_codigo_key" ON "Package"("codigo");

-- CreateIndex
CREATE INDEX "ServiceOrder_vehicleId_deliveredAt_idx" ON "ServiceOrder"("vehicleId", "deliveredAt");

-- CreateIndex
CREATE INDEX "ServiceOrder_bayId_idx" ON "ServiceOrder"("bayId");

-- CreateIndex
CREATE INDEX "ServiceOrder_deliveredAt_faseActual_idx" ON "ServiceOrder"("deliveredAt", "faseActual");

-- CreateIndex
CREATE INDEX "PhaseEvent_orderId_idx" ON "PhaseEvent"("orderId");

-- CreateIndex
CREATE INDEX "AiAnalysis_orderId_idx" ON "AiAnalysis"("orderId");

-- CreateIndex
CREATE INDEX "Evidence_serviceOrderId_idx" ON "Evidence"("serviceOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "SearchedPlate_userId_lastSearchedAt_idx" ON "SearchedPlate"("userId", "lastSearchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SearchedPlate_userId_placa_key" ON "SearchedPlate"("userId", "placa");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES "Bay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseEvent" ADD CONSTRAINT "PhaseEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchedPlate" ADD CONSTRAINT "SearchedPlate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

