const packageService = require('../services/package.service');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Fetch all packages
 */
const getPackages = asyncHandler(async (req, res) => {
  const packages = await packageService.getAllPackages();
  res.status(200).json(packages);
});

module.exports = {
  getPackages,
};
