const { computeOrderEta } = require('./eta.service');

/**
 * Builds the minimal view for an active order and its vehicle.
 *
 * @param {object} vehicle
 * @param {object} activeOrder
 * @returns {Promise<object>}
 */
const buildMinimalPlateView = async (vehicle, activeOrder) => {
  const eta = await computeOrderEta(activeOrder);
  return {
    placa: vehicle.placa,
    marca: vehicle.marca,
    modelo: vehicle.modelo,
    color: vehicle.color,
    fase: activeOrder.faseActual,
    porcentajeProgreso: activeOrder.porcentajeProgreso,
    listoParaLavar: activeOrder.listoParaLavar,
    startedAt: activeOrder.readyAt ? activeOrder.readyAt.toISOString() : null,
    receivedAt: activeOrder.createdAt ? activeOrder.createdAt.toISOString() : null,
    etaMinutes: eta.etaMinutes,
    etaLabel: eta.etaLabel,
    estimatedReadyAt: eta.estimatedReadyAt,
  };
};

module.exports = {
  buildMinimalPlateView,
};
