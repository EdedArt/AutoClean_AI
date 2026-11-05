const fs = require('fs');
const prisma = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const aiService = require('./ai');

/**
 * Normalizes a license plate by trimming, uppercasing, and removing spaces/hyphens.
 *
 * @param {string|null|undefined} str
 * @returns {string}
 */
function normalizePlate(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Safely removes a file from disk without throwing.
 *
 * @param {string} filePath
 */
function safeUnlink(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
  }
}

/**
 * Camera frame AI vision analysis for a service order.
 *
 * @param {object} params
 * @param {number|string} params.orderId
 * @param {{ path: string, filename: string, mimetype: string }|null|undefined} params.file
 * @param {boolean} [params.saveEvidence]
 * @param {string} [params.scenario]
 * @returns {Promise<object>}
 */
const analyzeOrderImage = async ({ orderId: rawOrderId, file, saveEvidence: rawSaveEvidence, scenario }) => {
  const orderId = Number(rawOrderId);

  if (!file) {
    throw AppError.badRequest('No se ha proporcionado ningún archivo de imagen', 'FILE_MISSING');
  }

  const order = await prisma.serviceOrder.findUnique({
    where: { id: orderId },
    include: {
      vehicle: true,
      package: true,
      bay: true,
    },
  });

  if (!order) {
    safeUnlink(file.path);
    throw AppError.notFound('Service order not found');
  }

  if (order.deliveredAt) {
    safeUnlink(file.path);
    throw AppError.conflict('Order is already delivered', 'ALREADY_DELIVERED');
  }

  if (!order.listoParaLavar) {
    safeUnlink(file.path);
    throw AppError.conflict('Order is not ready to wash yet', 'NOT_READY');
  }

  if (order.faseActual === 'LISTO') {
    safeUnlink(file.path);
    throw AppError.conflict('Order is already completed', 'INVALID_STATE');
  }

  let buffer;
  try {
    buffer = await fs.promises.readFile(file.path);
  } catch (readErr) {
    safeUnlink(file.path);
    throw AppError.internal('Failed to read uploaded image file');
  }

  let aiResult;
  try {
    aiResult = await aiService.analyze({
      buffer,
      mimeType: file.mimetype,
      expectedPlate: order.vehicle.placa,
      currentPhase: order.faseActual,
      orderId: order.id,
      scenario,
    });
  } catch (aiErr) {
    safeUnlink(file.path);

    // Record error in audit table if possible
    await prisma.aiAnalysis.create({
      data: {
        orderId: order.id,
        provider: 'gemini',
        model: env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
        plateDetected: null,
        plateMatched: false,
        phaseDetected: null,
        confidence: null,
        outcome: 'ERROR',
        fallbackUsed: false,
        latencyMs: 0,
      },
    }).catch(() => {});

    throw aiErr;
  }

  return { order, aiResult, saveEvidence: rawSaveEvidence !== false };
};

/**
 * Returns current status and capability of the AI vision system.
 * NEVER returns the API key.
 *
 * @returns {object}
 */
const getAiStatus = () => {
  return aiService.getAiStatus();
};

/**
 * Fetches paginated history of AI analysis attempts for a service order.
 *
 * @param {number|string} id
 * @param {object} [query]
 * @returns {Promise<object>}
 */
const getOrderAnalyses = async (id, query = {}) => {
  const orderId = Number(id);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const order = await prisma.serviceOrder.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw AppError.notFound('Service order not found');
  }

  const [total, analyses] = await Promise.all([
    prisma.aiAnalysis.count({
      where: { orderId },
    }),
    prisma.aiAnalysis.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const totalPages = Math.ceil(total / limit) || (total === 0 ? 0 : 1);

  return {
    data: analyses,
    meta: {
      page,
      limit,
      total,
      totalPages,
    },
  };
};

module.exports = {
  analyzeOrderImage,
  normalizePlate,
  getAiStatus,
  getOrderAnalyses,
};
