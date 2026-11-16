const fs = require('fs');
const prisma = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { doesOrderIncludePolichado } = require('./simulation.service');
const { evaluatePhaseTransition, AI_OUTCOMES } = require('./ai/phaseRules');
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
      phaseEvents: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
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

  const incluyePolichado = doesOrderIncludePolichado(order);
  const matchingPhaseEvent =
    order.phaseEvents && order.phaseEvents.find((e) => e.fase === order.faseActual);
  const latestPhaseEvent =
    matchingPhaseEvent || (order.phaseEvents && order.phaseEvents[0]) || null;
  let lastPhaseChangeAt = order.updatedAt || order.createdAt;
  if (latestPhaseEvent && order.updatedAt) {
    lastPhaseChangeAt = new Date(
      Math.min(
        new Date(latestPhaseEvent.createdAt).getTime(),
        new Date(order.updatedAt).getTime()
      )
    );
  } else if (latestPhaseEvent) {
    lastPhaseChangeAt = latestPhaseEvent.createdAt;
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
      incluyePolichado,
      lastPhaseChangeAt,
      order,
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
  const configuredMinConfidence = Number(env.AI_MIN_CONFIDENCE);
  const minConfidence = Number.isFinite(configuredMinConfidence) ? configuredMinConfidence : 0.6;
  const detectedPhase = aiResult.result.phase;

  const auditBase = {
    orderId: order.id,
    provider: aiResult.provider,
    model: aiResult.model,
    plateDetected: rawDetectedPlate,
    phaseDetected: detectedPhase,
    fallbackUsed: aiResult.fallbackUsed,
    latencyMs: aiResult.latencyMs,
  };

  // a) Unreadable license plate or low plate confidence
  if (!rawDetectedPlate || plateConfidence < minConfidence) {
    safeUnlink(file.path);
    await prisma.aiAnalysis.create({
      data: { ...auditBase, plateMatched: false, confidence: plateConfidence, outcome: 'PLATE_UNREADABLE' },
    });
    throw new AppError(
      'Unable to read license plate with sufficient confidence',
      422,
      'PLATE_UNREADABLE',
      {
        outcome: AI_OUTCOMES.PLATE_UNREADABLE,
        detected: rawDetectedPlate || null,
        confidence: plateConfidence,
        minConfidence,
      }
    );
  }

  // b) Wrong vehicle / plate mismatch
  if (detectedNormalized !== expectedNormalized) {
    safeUnlink(file.path);
    await prisma.aiAnalysis.create({
      data: { ...auditBase, plateMatched: false, confidence: plateConfidence, outcome: 'WRONG_VEHICLE' },
    });
    throw new AppError(
      'Wrong vehicle: the plate in the image does not match this order',
      409,
      'WRONG_VEHICLE',
      {
        outcome: AI_OUTCOMES.PLATE_MISMATCH,
        detected: rawDetectedPlate,
        expected: order.vehicle.placa,
        confidence: plateConfidence,
      }
    );
  }

  // c) Plate matched: decide the transition (confidence, package, direction).
  // The photo is operator-initiated, so the 70% minimum-time rule does NOT apply here
  // (it only governs SIMULATION/AUTO advances): elapsedMs is intentionally not passed.
  const decision = evaluatePhaseTransition({
    currentPhase: order.faseActual,
    detectedPhase,
    confidence: phaseConfidence,
    minConfidence,
    incluyePolichado,
  });

  const outcomeCode = decision.outcome;
  let changed = false;

  if (outcomeCode === AI_OUTCOMES.ADVANCED) {
    // source 'AI' is immediate in changePhase (same as MANUAL)
    await changePhase(order.id, decision.to, { source: 'AI' });
    changed = true;
  }

  const regression = outcomeCode === AI_OUTCOMES.SAME_OR_PREVIOUS_PHASE && decision.regression;
  const AUDIT_OUTCOME = {
    [AI_OUTCOMES.ADVANCED]: 'APPLIED',
    [AI_OUTCOMES.LOW_CONFIDENCE]: 'LOW_CONFIDENCE',
    [AI_OUTCOMES.PHASE_NOT_IN_PACKAGE]: 'PHASE_NOT_IN_PACKAGE',
  };
  const auditOutcome =
    AUDIT_OUTCOME[outcomeCode] || (regression ? 'REGRESSION_IGNORED' : 'UNCHANGED');

  // d) If vehicle's nivelSuciedad is null and AI returned dirtLevel, fill it in (trusted results only)
  if (
    outcomeCode !== AI_OUTCOMES.LOW_CONFIDENCE &&
    !order.vehicle.nivelSuciedad &&
    aiResult.result.dirtLevel
  ) {
    await prisma.vehicle.update({
      where: { id: order.vehicle.id },
      data: { nivelSuciedad: aiResult.result.dirtLevel },
    });
  }

  // Fetch updated order representation with relations
  const finalOrder = await prisma.serviceOrder.findUnique({
    where: { id: order.id },
    include: {
      vehicle: true,
      package: true,
      bay: true,
    },
  });

  // e) Save photo evidence (plate matched) tagged with the resulting phase
  let evidenceRecord = null;
  if (saveEvidence && file) {
    evidenceRecord = await prisma.evidence.create({
      data: {
        url: `/evidence/${file.filename}`,
        etapa: finalOrder.faseActual,
        serviceOrderId: order.id,
      },
    });
  } else {
    safeUnlink(file.path);
  }

  await prisma.aiAnalysis.create({
    data: { ...auditBase, plateMatched: true, confidence: phaseConfidence, outcome: auditOutcome },
  });

  return {
    provider: aiResult.provider,
    model: aiResult.model,
    fallbackUsed: aiResult.fallbackUsed,
    outcome: {
      code: outcomeCode,
      from: order.faseActual,
      to: finalOrder.faseActual,
      detected: detectedPhase,
      confidence: phaseConfidence,
      minConfidence,
      remainingMs: decision.remainingMs,
      requiredMs: decision.requiredMs,
    },
    plate: {
      detected: rawDetectedPlate,
      expected: order.vehicle.placa,
      matched: true,
      confidence: plateConfidence,
    },
    phase: {
      previous: order.faseActual,
      detected: detectedPhase,
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
