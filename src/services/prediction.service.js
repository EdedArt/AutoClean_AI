const {
  VALID_PHASES,
  getPhaseDurationMs,
  doesOrderIncludePolichado,
} = require('./simulation.service');

const PHASES_WITHOUT_POLICHADO = ['PENDIENTE', 'REMOJO', 'LAVADO', 'SECADO', 'LISTO'];
const PHASES_WITH_POLICHADO = ['PENDIENTE', 'REMOJO', 'LAVADO', 'SECADO', 'POLICHADO', 'LISTO'];

/**
 * Calculates remaining phase count until "LISTO".
 * Counts POLICHADO as a remaining phase ONLY if the order's package includes polichado
 * (or if the order is currently in POLICHADO).
 *
 * @param {string|object} currentPhase
 * @param {object|boolean} [orderOrIncluyePolichado=false]
 * @returns {number}
 */
const getRemainingPhasesCount = (currentPhase, orderOrIncluyePolichado = false) => {
  let resolvedPhase = currentPhase;
  let resolvedOrderOrFlag = orderOrIncluyePolichado;

  if (currentPhase && typeof currentPhase === 'object') {
    resolvedOrderOrFlag = currentPhase;
    resolvedPhase = currentPhase.faseActual;
  }

  const hasPolichado =
    doesOrderIncludePolichado(resolvedOrderOrFlag) || resolvedPhase === 'POLICHADO';
  const sequence = hasPolichado ? PHASES_WITH_POLICHADO : PHASES_WITHOUT_POLICHADO;

  const listoIndex = sequence.indexOf('LISTO');
  const currentIndex = sequence.indexOf(resolvedPhase);

  if (currentIndex === -1 || listoIndex === -1) {
    return 0;
  }

  return Math.max(0, listoIndex - currentIndex);
};

/**
 * Generates a deterministic pseudo-random accuracy percentage between 88 and 97
 * seeded by the order's ID.
 *
 * @param {number|string} orderId
 * @returns {number} Integer between 88 and 97
 */
const getDeterministicAccuracy = (orderId) => {
  if (orderId === undefined || orderId === null) {
    return 92;
  }

  const str = String(orderId);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }

  return 88 + (hash % 10);
};

/**
 * Calculates delivery time prediction for a service order.
 * Fully simulated deterministic logic.
 *
 * @param {object} order - Service order object with at least { id, faseActual, updatedAt, createdAt }
 * @param {object} [options] - Optional overrides for testing (e.g. now, phaseDurationMs)
 * @returns {object} { estimatedDeliveryTime, accuracyPercentage, recalculated, message }
 */
const calculateDeliveryPrediction = (order, options = {}) => {
  if (!order) {
    return null;
  }

  const now = options.now !== undefined ? options.now : Date.now();
  const phaseDurationMs =
    options.phaseDurationMs !== undefined ? options.phaseDurationMs : getPhaseDurationMs();

  // If already LISTO: delivery time is actual finish time, accuracy is 100%, no further prediction logic applies
  if (order.faseActual === 'LISTO') {
    const finishedAt = order.updatedAt || order.createdAt || now;
    return {
      estimatedDeliveryTime: new Date(finishedAt),
      accuracyPercentage: 100,
      recalculated: false,
      message: null,
    };
  }

  const remainingPhases = getRemainingPhasesCount(order.faseActual, order);
  const remainingTimeMs = remainingPhases * phaseDurationMs;
  const estimatedDeliveryTime = new Date(now + remainingTimeMs);
  const accuracyPercentage = getDeterministicAccuracy(order.id);

  // Delay detection: check if time elapsed in current phase exceeds phase duration
  // Only applies when listoParaLavar is true; a PENDIENTE order not yet ready is never flagged as delayed
  const lastChangeTime = new Date(order.updatedAt || order.createdAt || now).getTime();
  const elapsed = now - lastChangeTime;
  const isDelayed = Boolean(order.listoParaLavar) && !isNaN(lastChangeTime) && elapsed > phaseDurationMs;

  const recalculated = isDelayed;
  const message = isDelayed ? 'Tiempo recalculado por posible retraso' : null;

  return {
    estimatedDeliveryTime,
    accuracyPercentage,
    recalculated,
    message,
  };
};

module.exports = {
  getRemainingPhasesCount,
  getDeterministicAccuracy,
  calculateDeliveryPrediction,
};
