const prisma = require('../config/db');

/**
 * Fetch all packages
 */
const getPackages = async (req, res, next) => {
  try {
    const packages = await prisma.package.findMany({
      orderBy: { id: 'asc' },
    });
    res.status(200).json(packages);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPackages,
};
