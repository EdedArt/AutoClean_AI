const fs = require('fs');
const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { checkOrderAccess } = require('../utils/ownership');

/**
 * Upload photo evidence for a service order
 */
const uploadEvidence = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  if (!req.file) {
    throw AppError.badRequest('No se ha proporcionado ningún archivo de imagen', 'FILE_MISSING');
  }

  const order = await prisma.serviceOrder.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}
    }
    throw AppError.notFound('Service order not found');
  }

  const etapa = req.body.etapa || order.faseActual || 'PENDIENTE';
  const relativeUrl = `/evidence/${req.file.filename}`;

  try {
    const evidence = await prisma.evidence.create({
      data: {
        url: relativeUrl,
        etapa,
        serviceOrderId: orderId,
      },
    });

    res.status(201).json(evidence);
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}
    }
    throw error;
  }
});

/**
 * Fetch all evidences for a specific service order
 */
const getEvidencesByOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const order = await prisma.serviceOrder.findUnique({
    where: { id: orderId },
    include: {
      vehicle: true,
    },
  });

  if (!order) {
    throw AppError.notFound('Service order not found');
  }

  checkOrderAccess(order, req.user);

  const evidences = await prisma.evidence.findMany({
    where: { serviceOrderId: orderId },
    orderBy: { createdAt: 'desc' },
  });

  res.status(200).json(evidences);
});

module.exports = {
  uploadEvidence,
  getEvidencesByOrder,
};
