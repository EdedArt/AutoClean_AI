const fs = require('fs');
const prisma = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { VALID_PHASES } = require('../services/simulation.service');
const { changePhase } = require('../services/orderPhase.service');
const aiService = require('../services/ai');

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
 */
const analyzeOrderImage = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);

  if (!req.file) {
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
    safeUnlink(req.file.path);
    throw AppError.notFound('Service order not found');
  }

  if (order.deliveredAt) {
    safeUnlink(req.file.path);
    throw AppError.conflict('Order is already delivered', 'ALREADY_DELIVERED');
  }

  if (!order.listoParaLavar) {
    safeUnlink(req.file.path);
    throw AppError.conflict('Order is not ready to wash yet', 'NOT_READY');
  }

  if (order.faseActual === 'LISTO') {
    safeUnlink(req.file.path);
    throw AppError.conflict('Order is already completed', 'INVALID_STATE');
  }

  const saveEvidence = req.body.saveEvidence !== false;
  const scenario = req.body.scenario;

  let buffer;
  try {
    buffer = await fs.promises.readFile(req.file.path);
  } catch (readErr) {
    safeUnlink(req.file.path);
    throw AppError.internal('Failed to read uploaded image file');
  }

  let aiResult;
  try {
    aiResult = await aiService.analyze({
      buffer,
      mimeType: req.file.mimetype,
      expectedPlate: order.vehicle.placa,
      currentPhase: order.faseActual,
      orderId: order.id,
      scenario,
    });
  } catch (aiErr) {
    safeUnlink(req.file.path);

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
    safeUnlink(req.file.path);

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
    safeUnlink(req.file.path);

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
    if (saveEvidence && req.file) {
      const relativeUrl = `/evidence/${req.file.filename}`;
      evidenceRecord = await prisma.evidence.create({
        data: {
          url: relativeUrl,
          etapa: order.faseActual,
          serviceOrderId: order.id,
        },
      });
    } else {
      safeUnlink(req.file.path);
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

    return res.status(200).json({
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
    });
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

  if (saveEvidence && req.file) {
    const relativeUrl = `/evidence/${req.file.filename}`;
    evidenceRecord = await prisma.evidence.create({
      data: {
        url: relativeUrl,
        etapa: resultingPhase,
        serviceOrderId: order.id,
      },
    });
  } else {
    safeUnlink(req.file.path);
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

  res.status(200).json({
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
  });
});

/**
 * Returns current status and capability of the AI vision system.
 * NEVER returns the API key.
 */
const getAiStatus = asyncHandler(async (req, res) => {
  const status = aiService.getAiStatus();
  res.status(200).json(status);
});

/**
 * Fetches paginated history of AI analysis attempts for a service order.
 */
const getOrderAnalyses = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
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

  res.status(200).json({
    data: analyses,
    meta: {
      page,
      limit,
      total,
      totalPages,
    },
  });
});

module.exports = {
  analyzeOrderImage,
  getAiStatus,
  getOrderAnalyses,
  normalizePlate,
};
