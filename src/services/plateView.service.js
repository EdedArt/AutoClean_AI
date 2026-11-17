const { computeOrderEta } = require('./eta.service');
const { isBodyType } = require('./vehicleStyle/bodyTypes');
const { mapColor } = require('./vehicleStyle/colorMapper');

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
    // Vehicle style for the tracking illustration (no owner data)
    bodyType: isBodyType(vehicle.bodyType) ? vehicle.bodyType : null,
    colorHex: mapColor(vehicle.color).hex,
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
