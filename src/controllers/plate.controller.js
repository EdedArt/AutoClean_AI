const asyncHandler = require('../utils/asyncHandler');
const plateService = require('../services/plate.service');

/**
 * GET /api/plates/:placa/status
 * Public minimal view for any authenticated user.
 */
const getPlateStatus = asyncHandler(async (req, res) => {
  const { placa } = req.params;
  const responseData = await plateService.getPlateStatus(placa, req.user);
  res.status(200).json(responseData);
});

module.exports = {
  recordPlateSearch: plateService.recordPlateSearch,
  buildMinimalPlateView: plateService.buildMinimalPlateView,
  getPlateStatus,
};
