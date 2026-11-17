-- Additive: nullable column; existing rows keep NULL (no backfill)
ALTER TABLE "Vehicle" ADD COLUMN "bodyType" TEXT;
