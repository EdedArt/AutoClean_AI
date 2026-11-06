const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const {
  VALID_PHASES,
  PHASE_PROGRESS_MAP,
  PHASE_ESTIMATED_DURATION_MINUTES,
  MIN_PHASE_TIME_RATIO,
  doesOrderIncludePolichado,
  getEstimatedDurationMinutesForPhase,
  getEstimatedDurationForPhase,
  getNextPhase,
} = require('./simulation.service');

/**
 * Changes the phase of a service order inside a single transaction.
 * Audits the transition via PhaseEvent, maintains ready-to-wash status,
 * enforces minimum realistic phase duration for automatic transitions,
 * and manages bay occupancy lifecycle.
 *
 * @param {number|string} orderId
 * @param {string} [newPhase]
 * @param {object} [options]
 * @param {string} [options.source='MANUAL'] - 'MANUAL' | 'AUTO' | 'SIMULATION' | 'DEMO' | 'AI'
 * @param {Date|number} [options.updatedAt] - Optional timestamp for simulation
 * @param {Date|number} [options.now] - Optional current timestamp override
 * @param {Date|number} [options.lastPhaseChangeAt] - Optional last phase change timestamp override
 * @param {number} [options.durationMs] - Optional explicit duration override in ms
 * @returns {Promise<object>} The updated service order with relations (or { advanced: false, reason: 'MIN_TIME_NOT_REACHED' })
 */
const changePhase = async (orderId, newPhase, options = {}) => {
  const id = Number(orderId);
  if (isNaN(id)) {
    throw AppError.badRequest('Invalid order ID', 'INVALID_ID');
  }

  if (newPhase !== undefined && newPhase !== null && !VALID_PHASES.includes(newPhase)) {
    throw AppError.badRequest(`Invalid phase: ${newPhase}`, 'INVALID_PHASE');
  }

  const source = options.source || 'MANUAL';
  const rawTimestamp = options.updatedAt !== undefined ? options.updatedAt : options.now;
  const timestamp = rawTimestamp !== undefined ? new Date(rawTimestamp) : new Date();

  return await prisma.$transaction(async (tx) => {
    const order = await tx.serviceOrder.findUnique({
      where: { id },
      include: {
        bay: true,
        package: true,
        phaseEvents: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!order) {
      throw AppError.notFound('Service order not found');
    }

    if (order.deliveredAt) {
      throw AppError.conflict('Order is already delivered', 'ALREADY_DELIVERED');
    }

    const currentPhase = order.faseActual;
    const resolvedNewPhase = newPhase || getNextPhase(currentPhase, order);

    if (!resolvedNewPhase || !VALID_PHASES.includes(resolvedNewPhase)) {
      throw AppError.badRequest(`Invalid phase: ${resolvedNewPhase}`, 'INVALID_PHASE');
    }

    // Automatic phase progression check: enforce 70% minimum phase duration
    // Exceptions:
    // - PENDIENTE -> REMOJO is always immediate
    // - MANUAL (and DEMO) transitions are always immediate
    const isAutoSource = source === 'AUTO' || source === 'SIMULATION' || source === 'AI';
    const isPendienteToRemojo = currentPhase === 'PENDIENTE' && resolvedNewPhase === 'REMOJO';

    if (isAutoSource && currentPhase !== 'PENDIENTE' && !isPendienteToRemojo) {
      let lastPhaseChangeAtMs;
      if (options.lastPhaseChangeAt !== undefined && options.lastPhaseChangeAt !== null) {
        lastPhaseChangeAtMs = new Date(options.lastPhaseChangeAt).getTime();
      } else if (order.lastPhaseChangeAt !== undefined && order.lastPhaseChangeAt !== null) {
        lastPhaseChangeAtMs = new Date(order.lastPhaseChangeAt).getTime();
      } else {
        const matchingEvent =
          order.phaseEvents && order.phaseEvents.find((e) => e.fase === currentPhase);
        const latestEvent =
          matchingEvent || (order.phaseEvents && order.phaseEvents[0]) || null;
        const eventMs = latestEvent ? new Date(latestEvent.createdAt).getTime() : NaN;
        const updatedMs = order.updatedAt ? new Date(order.updatedAt).getTime() : NaN;

        if (!isNaN(eventMs) && !isNaN(updatedMs)) {
          lastPhaseChangeAtMs = Math.min(eventMs, updatedMs);
        } else if (!isNaN(eventMs)) {
          lastPhaseChangeAtMs = eventMs;
        } else if (!isNaN(updatedMs)) {
          lastPhaseChangeAtMs = updatedMs;
        } else {
          lastPhaseChangeAtMs = new Date(order.createdAt).getTime();
        }
      }

      const tiempoEnFaseActual = timestamp.getTime() - lastPhaseChangeAtMs;
      const tiempoEstimadoFase = getEstimatedDurationForPhase(currentPhase);
      const minimoRequerido =
        options.durationMs !== undefined
          ? options.durationMs
          : tiempoEstimadoFase * MIN_PHASE_TIME_RATIO;

      if (!isNaN(tiempoEnFaseActual) && tiempoEnFaseActual < minimoRequerido) {
        return {
          ...order,
          advanced: false,
          reason: 'MIN_TIME_NOT_REACHED',
        };
      }
    }

    const incluyePolichado = doesOrderIncludePolichado(order);
    const progressMap = PHASE_PROGRESS_MAP(incluyePolichado);
    const progreso =
      progressMap[resolvedNewPhase] ?? (resolvedNewPhase === 'POLICHADO' ? 85 : 100);
    const isNewPhaseListo = resolvedNewPhase === 'LISTO';
    const isOldPhaseListo = currentPhase === 'LISTO';
    const listoParaLavar = resolvedNewPhase !== 'PENDIENTE';

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
      faseActual: resolvedNewPhase,
      porcentajeProgreso: progreso,
      listoParaLavar,
      updatedAt: timestamp,
    };

    if (resolvedNewPhase === 'PENDIENTE') {
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
        fase: resolvedNewPhase,
        progreso,
        source,
        createdAt: timestamp,
      },
    });

    Object.defineProperty(updatedOrder, 'advanced', {
      value: true,
      enumerable: false,
      configurable: true,
      writable: true,
    });

    return updatedOrder;
  });
};

module.exports = {
  changePhase,
  getNextPhase,
  PHASE_PROGRESS_MAP,
  PHASE_ESTIMATED_DURATION_MINUTES,
  MIN_PHASE_TIME_RATIO,
  doesOrderIncludePolichado,
  getEstimatedDurationMinutesForPhase,
  getEstimatedDurationForPhase,
};
