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

module.exports = {
  getBays,
};
