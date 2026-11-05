const prisma = require('../config/db');

/**
 * Fetch all packages ordered by id ascending
 *
 * @returns {Promise<Array<object>>}
 */
const getAllPackages = async () => {
  return await prisma.package.findMany({
    orderBy: { id: 'asc' },
  });
};

module.exports = {
  getAllPackages,
};
