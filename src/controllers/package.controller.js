const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Fetch all packages
 */
const getPackages = asyncHandler(async (req, res) => {
  const packages = await prisma.package.findMany({
    orderBy: { id: 'asc' },
  });
  res.status(200).json(packages);
});

module.exports = {
  getPackages,
};
