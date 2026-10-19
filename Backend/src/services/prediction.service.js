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

  // If already LISTO: delivery time is actual finish time, no further prediction applies
  if (order.faseActual === 'LISTO') {
    const finishedAt = order.updatedAt || order.createdAt || now;
    return {
      estimatedDeliveryTime: new Date(finishedAt),
      accuracyPercentage: 0,
      recalculated: false,
      message: null,
    };
  }

  const remainingPhases = getRemainingPhasesCount(order.faseActual);
  const remainingTimeMs = remainingPhases * phaseDurationMs;
  const estimatedDeliveryTime = new Date(now + remainingTimeMs);

  return {
    estimatedDeliveryTime,
    accuracyPercentage: 0,
    recalculated: false,
    message: null,
  };
};

module.exports = {
  getRemainingPhasesCount,
  calculateDeliveryPrediction,
};
