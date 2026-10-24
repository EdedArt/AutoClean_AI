const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const { VALID_PHASES, PHASE_PROGRESS_MAP } = require('./simulation.service');

/**
 * Changes the phase of a service order inside a single transaction.
 * Audits the transition via PhaseEvent, maintains ready-to-wash status,
 * and manages bay occupancy lifecycle.
 *
 * @param {number|string} orderId
 * @param {string} newPhase
 * @param {object} [options]
 * @param {string} [options.source='MANUAL'] - 'MANUAL' | 'SIMULATION' | 'DEMO' | 'AI'
 * @param {Date|number} [options.updatedAt] - Optional timestamp for simulation
 * @returns {Promise<object>} The updated service order with relations
 */
const changePhase = async (orderId, newPhase, options = {}) => {
  const id = Number(orderId);
  if (isNaN(id)) {
    throw AppError.badRequest('Invalid order ID', 'INVALID_ID');
  }

  if (!VALID_PHASES.includes(newPhase)) {
    throw AppError.badRequest(`Invalid phase: ${newPhase}`, 'INVALID_PHASE');
  }

  const source = options.source || 'MANUAL';
  const timestamp = options.updatedAt ? new Date(options.updatedAt) : new Date();

  return await prisma.$transaction(async (tx) => {
    const order = await tx.serviceOrder.findUnique({
      where: { id },
      include: { bay: true },
    });

    if (!order) {
      throw AppError.notFound('Service order not found');
    }

    const progreso = PHASE_PROGRESS_MAP[newPhase];
    const isNewPhaseListo = newPhase === 'LISTO';
    const isOldPhaseListo = order.faseActual === 'LISTO';
    const listoParaLavar = newPhase !== 'PENDIENTE';

    // Bay lifecycle management
    if (order.bayId) {
      if (isNewPhaseListo) {
        // Free bay when order reaches LISTO
        await tx.bay.update({
          where: { id: order.bayId },
          data: { ocupada: false },
        });
      } else if (isOldPhaseListo && !isNewPhaseListo) {
        // If an order leaves LISTO (e.g. reset to PENDIENTE), re-occupy bay if free
        const bay = await tx.bay.findUnique({
          where: { id: order.bayId },
        });

        if (bay && bay.ocupada) {
          throw AppError.conflict('Bay is already occupied', 'BAY_OCCUPIED');
        }

        if (bay) {
          await tx.bay.update({
            where: { id: order.bayId },
            data: { ocupada: true },
          });
        }
      }
    }

    // Prepare order update data
    const updateData = {
      faseActual: newPhase,
      porcentajeProgreso: progreso,
      listoParaLavar,
      updatedAt: timestamp,
    };

    if (newPhase === 'PENDIENTE') {
      updateData.readyAt = null;
    }

    // Update the service order
    const updatedOrder = await tx.serviceOrder.update({
      where: { id },
      data: updateData,
      include: {
        vehicle: true,
        package: true,
        bay: true,
      },
    });

    // Audit transition in PhaseEvent
    await tx.phaseEvent.create({
      data: {
        orderId: id,
        fase: newPhase,
        progreso,
        source,
        createdAt: timestamp,
      },
    });

    return updatedOrder;
  });
};

module.exports = {
  changePhase,
};
