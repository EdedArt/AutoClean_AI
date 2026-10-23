const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Fetch all bays
 */
const getBays = asyncHandler(async (req, res) => {
  const bays = await prisma.bay.findMany({
    orderBy: { numero: 'asc' },
  });
  res.status(200).json(bays);
});

/**
 * Fetch bay occupancy summary (total, occupied, free)
 */
const getBaySummary = asyncHandler(async (req, res) => {
  const [total, occupied] = await prisma.$transaction([
    prisma.bay.count(),
    prisma.bay.count({ where: { ocupada: true } }),
  ]);
  const free = total - occupied;

  res.status(200).json({
    total,
    occupied,
    free,
  });
});

module.exports = {
  getBays,
  getBaySummary,
};
