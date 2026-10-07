const prisma = require('../config/db');

/**
 * Fetch all bays
 */
const getBays = async (req, res, next) => {
  try {
    const bays = await prisma.bay.findMany({
      orderBy: { numero: 'asc' },
    });
    res.status(200).json(bays);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBays,
};
