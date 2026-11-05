const bayService = require('../services/bay.service');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Fetch all bays
 */
const getBays = asyncHandler(async (req, res) => {
  const bays = await bayService.getAllBays();
  res.status(200).json(bays);
});

/**
 * Fetch bay occupancy summary (total, occupied, free)
 */
const getBaySummary = asyncHandler(async (req, res) => {
  const summary = await bayService.getBaySummary();
  res.status(200).json(summary);
});

module.exports = {
  getBays,
  getBaySummary,
};
