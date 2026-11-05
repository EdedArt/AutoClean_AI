const asyncHandler = require('../utils/asyncHandler');
const aiAnalysisService = require('../services/aiAnalysis.service');

/**
 * Camera frame AI vision analysis for a service order.
 * Reads license plate, identifies wash phase, and advances order automatically.
 */
const analyzeOrderImage = asyncHandler(async (req, res) => {
  const file = req.file
    ? {
        path: req.file.path,
        filename: req.file.filename,
        mimetype: req.file.mimetype,
      }
    : null;

  const result = await aiAnalysisService.analyzeOrderImage({
    orderId: req.params.id,
    file,
    saveEvidence: req.body.saveEvidence,
    scenario: req.body.scenario,
  });

  res.status(200).json(result);
});

/**
 * Returns current status and capability of the AI vision system.
 * NEVER returns the API key.
 */
const getAiStatus = asyncHandler(async (req, res) => {
  const status = aiAnalysisService.getAiStatus();
  res.status(200).json(status);
});

/**
 * Fetches paginated history of AI analysis attempts for a service order.
 */
const getOrderAnalyses = asyncHandler(async (req, res) => {
  const response = await aiAnalysisService.getOrderAnalyses(req.params.id, req.query || {});
  res.status(200).json(response);
});

module.exports = {
  analyzeOrderImage,
  getAiStatus,
  getOrderAnalyses,
  normalizePlate: aiAnalysisService.normalizePlate,
};
