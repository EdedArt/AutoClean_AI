const asyncHandler = require('../utils/asyncHandler');
const { PHASE_CATALOG } = require('../services/simulation.service');

/**
 * Returns the wash phases catalog
 */
const getPhases = asyncHandler(async (req, res) => {
  res.status(200).json(PHASE_CATALOG);
});

module.exports = {
  getPhases,
};
