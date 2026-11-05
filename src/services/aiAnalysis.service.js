const fs = require('fs');
const prisma = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { VALID_PHASES } = require('./simulation.service');
const { changePhase } = require('./orderPhase.service');
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
 * Reads license plate, identifies wash phase, and advances order automatically.
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

  const saveEvidence = rawSaveEvidence !== false;

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

  const rawDetectedPlate = aiResult.result.plateDetected;
  const detectedNormalized = normalizePlate(rawDetectedPlate);
  const expectedNormalized = normalizePlate(order.vehicle.placa);
  const plateConfidence = Number(aiResult.result.plateConfidence) || 0;
  const phaseConfidence = Number(aiResult.result.phaseConfidence) || 0;
  const minConfidence = env.AI_MIN_CONFIDENCE || 0.6;

  // a) Unreadable license plate or low confidence
  if (!rawDetectedPlate || plateConfidence < minConfidence) {
    safeUnlink(file.path);

    await prisma.aiAnalysis.create({
      data: {
        orderId: order.id,
        provider: aiResult.provider,
        model: aiResult.model,
        plateDetected: rawDetectedPlate,
        plateMatched: false,
        phaseDetected: aiResult.result.phase,
        confidence: plateConfidence,
        outcome: 'PLATE_UNREADABLE',
        fallbackUsed: aiResult.fallbackUsed,
        latencyMs: aiResult.latencyMs,
      },
    });

    throw AppError.unprocessable('Unable to read license plate with sufficient confidence', 'PLATE_UNREADABLE');
  }

  // b) Wrong vehicle / plate mismatch
  if (detectedNormalized !== expectedNormalized) {
    safeUnlink(file.path);

    await prisma.aiAnalysis.create({
      data: {
        orderId: order.id,
        provider: aiResult.provider,
        model: aiResult.model,
        plateDetected: rawDetectedPlate,
        plateMatched: false,
        phaseDetected: aiResult.result.phase,
        confidence: plateConfidence,
        outcome: 'WRONG_VEHICLE',
        fallbackUsed: aiResult.fallbackUsed,
        latencyMs: aiResult.latencyMs,
      },
    });

    throw new AppError(
      'Wrong vehicle: the plate in the image does not match this order',
      409,
      'WRONG_VEHICLE',
      { detected: rawDetectedPlate, expected: order.vehicle.placa }
    );
  }

  // c) Plate matched, but phaseConfidence < AI_MIN_CONFIDENCE
  if (phaseConfidence < minConfidence) {
    let evidenceRecord = null;
    if (saveEvidence && file) {
      const relativeUrl = `/evidence/${file.filename}`;
      evidenceRecord = await prisma.evidence.create({
        data: {
          url: relativeUrl,
          etapa: order.faseActual,
          serviceOrderId: order.id,
        },
      });
    } else {
      safeUnlink(file.path);
    }

    await prisma.aiAnalysis.create({
      data: {
        orderId: order.id,
        provider: aiResult.provider,
        model: aiResult.model,
        plateDetected: rawDetectedPlate,
        plateMatched: true,
        phaseDetected: aiResult.result.phase,
        confidence: phaseConfidence,
        outcome: 'LOW_CONFIDENCE',
        fallbackUsed: aiResult.fallbackUsed,
        latencyMs: aiResult.latencyMs,
      },
    });

    return {
      provider: aiResult.provider,
      model: aiResult.model,
      fallbackUsed: aiResult.fallbackUsed,
      plate: {
        detected: rawDetectedPlate,
        expected: order.vehicle.placa,
        matched: true,
        confidence: plateConfidence,
      },
      phase: {
        previous: order.faseActual,
        detected: aiResult.result.phase,
        current: order.faseActual,
        changed: false,
        regression: false,
        confidence: phaseConfidence,
        source: aiResult.result.phaseSource || 'model',
        reason: aiResult.result.phaseReason || null,
      },
      observations: aiResult.result.observations || null,
      phaseSource: aiResult.result.phaseSource || 'model',
      phaseReason: aiResult.result.phaseReason || null,
      dirtLevel: aiResult.result.dirtLevel,
      notes: aiResult.result.notes,
      evidenceId: evidenceRecord ? evidenceRecord.id : null,
      order,
    };
  }

  // d) Compare detected phase with current one using VALID_PHASES
  const currentIdx = VALID_PHASES.indexOf(order.faseActual);
  const detectedIdx = VALID_PHASES.indexOf(aiResult.result.phase);
  let changed = false;
  let regression = false;
  let outcome = 'UNCHANGED';
  let targetOrder = order;

  if (detectedIdx > currentIdx) {
    // Later phase: advance automatically via changePhase with source "AI"
    targetOrder = await changePhase(order.id, aiResult.result.phase, { source: 'AI' });
    changed = true;
    outcome = 'APPLIED';
  } else if (detectedIdx < currentIdx) {
    // Earlier phase: do NOT move backwards
    regression = true;
    outcome = 'REGRESSION_IGNORED';
  } else {
    outcome = 'UNCHANGED';
  }

  // e) If vehicle's nivelSuciedad is null and AI returned dirtLevel, fill it in
  if (!order.vehicle.nivelSuciedad && aiResult.result.dirtLevel) {
    await prisma.vehicle.update({
      where: { id: order.vehicle.id },
      data: { nivelSuciedad: aiResult.result.dirtLevel },
    });
    if (targetOrder.vehicle) {
      targetOrder.vehicle.nivelSuciedad = aiResult.result.dirtLevel;
    }
  }

  // f) Save photo evidence if saveEvidence is true and plate matched
  let evidenceRecord = null;
  const resultingPhase = targetOrder.faseActual;

  if (saveEvidence && file) {
    const relativeUrl = `/evidence/${file.filename}`;
    evidenceRecord = await prisma.evidence.create({
      data: {
        url: relativeUrl,
        etapa: resultingPhase,
        serviceOrderId: order.id,
      },
    });
  } else {
    safeUnlink(file.path);
  }

  // Record AiAnalysis audit event
  await prisma.aiAnalysis.create({
    data: {
      orderId: order.id,
      provider: aiResult.provider,
      model: aiResult.model,
      plateDetected: rawDetectedPlate,
      plateMatched: true,
      phaseDetected: aiResult.result.phase,
      confidence: phaseConfidence,
      outcome,
      fallbackUsed: aiResult.fallbackUsed,
      latencyMs: aiResult.latencyMs,
    },
  });

  // Fetch updated order representation with relations
  const finalOrder = await prisma.serviceOrder.findUnique({
    where: { id: order.id },
    include: {
      vehicle: true,
      package: true,
      bay: true,
    },
  });

  return {
    provider: aiResult.provider,
    model: aiResult.model,
    fallbackUsed: aiResult.fallbackUsed,
    plate: {
      detected: rawDetectedPlate,
      expected: order.vehicle.placa,
      matched: true,
      confidence: plateConfidence,
    },
    phase: {
      previous: order.faseActual,
      detected: aiResult.result.phase,
      current: finalOrder.faseActual,
      changed,
      regression,
      confidence: phaseConfidence,
      source: aiResult.result.phaseSource || 'model',
      reason: aiResult.result.phaseReason || null,
    },
    observations: aiResult.result.observations || null,
    phaseSource: aiResult.result.phaseSource || 'model',
    phaseReason: aiResult.result.phaseReason || null,
    dirtLevel: aiResult.result.dirtLevel,
    notes: aiResult.result.notes,
    evidenceId: evidenceRecord ? evidenceRecord.id : null,
    order: finalOrder,
  };
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
