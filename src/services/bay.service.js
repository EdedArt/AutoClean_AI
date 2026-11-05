const prisma = require('../config/db');

/**
 * Fetch all bays ordered by bay number ascending
 *
 * @returns {Promise<Array<object>>}
 */
const getAllBays = async () => {
  return await prisma.bay.findMany({
    orderBy: { numero: 'asc' },
  });
};

/**
 * Fetch bay occupancy summary (total, occupied, free) inside a single transaction
 *
 * @returns {Promise<{ total: number, occupied: number, free: number }>}
 */
const getBaySummary = async () => {
  const [total, occupied] = await prisma.$transaction([
    prisma.bay.count(),
    prisma.bay.count({ where: { ocupada: true } }),
  ]);
  const free = total - occupied;

  return {
    total,
    occupied,
    free,
  };
};

module.exports = {
  getAllBays,
  getBaySummary,
};
