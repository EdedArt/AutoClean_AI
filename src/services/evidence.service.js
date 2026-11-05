const fs = require('fs');
const prisma = require('../config/db');
const AppError = require('../utils/AppError');

/**
 * Safely removes an uploaded file from disk without throwing.
 *
 * @param {string|undefined} filePath
 */
const safeUnlink = (filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
  }
};

/**
 * Upload photo evidence for a service order, cleaning up the disk file on failure.
 *
 * @param {object} params
 * @param {number} params.orderId
 * @param {string} [params.etapa]
 * @param {{ path: string, filename: string }|null|undefined} params.file
 * @returns {Promise<object>}
 */
const uploadEvidence = async ({ orderId, etapa: requestedEtapa, file }) => {
  if (!file) {
    throw AppError.badRequest('No se ha proporcionado ningún archivo de imagen', 'FILE_MISSING');
  }

  const order = await prisma.serviceOrder.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    safeUnlink(file.path);
    throw AppError.notFound('Service order not found');
  }

  const etapa = requestedEtapa || order.faseActual || 'PENDIENTE';
  const relativeUrl = `/evidence/${file.filename}`;

  try {
    return await prisma.evidence.create({
      data: {
        url: relativeUrl,
        etapa,
        serviceOrderId: orderId,
      },
    });
  } catch (error) {
    safeUnlink(file.path);
    throw error;
  }
};

/**
 * Fetch all evidences for a specific service order (OPERARIO only).
 *
 * @param {number} orderId
 * @param {object} user
 * @returns {Promise<Array<object>>}
 */
const getEvidencesByOrder = async (orderId, user) => {
  if (user && user.rol !== 'OPERARIO') {
    throw AppError.forbidden('Only operators can view photo evidence');
  }

  const order = await prisma.serviceOrder.findUnique({
    where: { id: orderId },
    include: {
      vehicle: true,
    },
  });

  if (!order) {
    throw AppError.notFound('Service order not found');
  }

  return await prisma.evidence.findMany({
    where: { serviceOrderId: orderId },
    orderBy: { createdAt: 'desc' },
  });
};

module.exports = {
  uploadEvidence,
  getEvidencesByOrder,
};
