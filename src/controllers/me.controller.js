const meService = require('../services/me.service');
const asyncHandler = require('../utils/asyncHandler');

/**
 * GET /api/me/plates
 * Search history for CLIENTE (ordered by lastSearchedAt desc, max 10).
 * Does not update lastSearchedAt.
 */
const getMyPlates = asyncHandler(async (req, res) => {
  const data = await meService.getSearchHistory(req.user.id);
  res.status(200).json({ data });
});

/**
 * DELETE /api/me/plates/:placa
 * Delete plate from user's search history.
 */
const deleteMyPlate = asyncHandler(async (req, res) => {
  const { placa } = req.params;
  await meService.deleteSearchHistoryPlate(req.user.id, placa);
  res.status(204).send();
});

module.exports = {
  getMyPlates,
  deleteMyPlate,
};
