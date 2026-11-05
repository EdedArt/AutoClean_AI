const asyncHandler = require('../utils/asyncHandler');
const evidenceService = require('../services/evidence.service');

/**
 * Upload photo evidence for a service order
 */
const uploadEvidence = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const file = req.file
    ? { path: req.file.path, filename: req.file.filename }
    : null;

  const evidence = await evidenceService.uploadEvidence({
    orderId,
    etapa: req.body.etapa,
    file,
  });

  res.status(201).json(evidence);
});

/**
 * Fetch all evidences for a specific service order
 */
const getEvidencesByOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const evidences = await evidenceService.getEvidencesByOrder(orderId, req.user);
  res.status(200).json(evidences);
});

module.exports = {
  uploadEvidence,
  getEvidencesByOrder,
};
