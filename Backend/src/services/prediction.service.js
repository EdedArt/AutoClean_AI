const { VALID_PHASES, getPhaseDurationMs } = require('./simulation.service');

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

  return {
    estimatedDeliveryTime: null,
    accuracyPercentage: 0,
    recalculated: false,
    message: null,
  };
};

module.exports = {
  calculateDeliveryPrediction,
};
