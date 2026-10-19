const { VALID_PHASES, getPhaseDurationMs } = require('./simulation.service');

/**
 * Calculates remaining phase count until "LISTO" based on the canonical
 * VALID_PHASES sequence defined in simulation.service.js.
 *
 * @param {string} currentPhase
 * @returns {number}
 */
const getRemainingPhasesCount = (currentPhase) => {
  const listoIndex = VALID_PHASES.indexOf('LISTO');
  const currentIndex = VALID_PHASES.indexOf(currentPhase);

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

  const remainingPhases = getRemainingPhasesCount(order.faseActual);
  const remainingTimeMs = remainingPhases * phaseDurationMs;
  const estimatedDeliveryTime = new Date(now + remainingTimeMs);
  const accuracyPercentage = getDeterministicAccuracy(order.id);

  return {
    estimatedDeliveryTime,
    accuracyPercentage,
    recalculated: false,
    message: null,
  };
};

module.exports = {
  getRemainingPhasesCount,
  getDeterministicAccuracy,
  calculateDeliveryPrediction,
};
