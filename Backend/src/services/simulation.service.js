const prisma = require('../config/db');

const VALID_PHASES = ['RECIBIDO', 'LAVADO', 'SECADO', 'LISTO'];

const NEXT_PHASE_MAP = {
  RECIBIDO: 'LAVADO',
  LAVADO: 'SECADO',
  SECADO: 'LISTO',
};

const PHASE_PROGRESS_MAP = {
  RECIBIDO: 10,
  LAVADO: 45,
  SECADO: 80,
  LISTO: 100,
};

const DEFAULT_PHASE_DURATION_MS = 60000; // 1 minute per phase by default

/**
 * Reads phase duration from environment variable SIMULATION_PHASE_DURATION_MS,
 * falling back to DEFAULT_PHASE_DURATION_MS (60000ms).
 * @returns {number}
 */
const getPhaseDurationMs = () => {
  const envVal = process.env.SIMULATION_PHASE_DURATION_MS;
  if (envVal !== undefined && envVal !== null && envVal !== '') {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_PHASE_DURATION_MS;
};

/**
 * Returns the next phase in the car wash cycle, or null if finished.
 * @param {string} currentPhase
 * @returns {string|null}
 */
const getNextPhase = (currentPhase) => {
  return NEXT_PHASE_MAP[currentPhase] || null;
};

/**
 * Checks whether an order is eligible to advance to the next phase based on elapsed time.
 * @param {object} order
 * @param {number} now
 * @param {number} durationMs
 * @returns {boolean}
 */
const shouldAdvancePhase = (order, now, durationMs) => {
  if (!order || !order.faseActual || order.faseActual === 'LISTO') {
    return false;
  }

  const nextPhase = getNextPhase(order.faseActual);
  if (!nextPhase) {
    return false;
  }

  const lastChangeTime = new Date(order.updatedAt || order.createdAt).getTime();
  if (isNaN(lastChangeTime)) {
    return false;
  }

  return (now - lastChangeTime) >= durationMs;
};

/**
 * Advances a service order to the next phase if enough time has passed.
 * Logs transition to the console for demo visibility.
 * @param {object} order
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {number} [options.durationMs]
 * @returns {Promise<object|null>} The updated order, or null if not advanced.
 */
const advanceOrderPhase = async (order, options = {}) => {
  if (!order || !order.id) {
    return null;
  }

  const now = options.now || Date.now();
  const durationMs = options.durationMs || getPhaseDurationMs();

  if (!shouldAdvancePhase(order, now, durationMs)) {
    return null;
  }

  const currentPhase = order.faseActual;
  const nextPhase = getNextPhase(currentPhase);
  const nextProgress = PHASE_PROGRESS_MAP[nextPhase];

  const updatedOrder = await prisma.serviceOrder.update({
    where: { id: order.id },
    data: {
      faseActual: nextPhase,
      porcentajeProgreso: nextProgress,
      updatedAt: new Date(now),
    },
    include: {
      vehicle: true,
      package: true,
      bay: true,
    },
  });

  console.log(`[SIMULATION] Order #${order.id} advanced ${currentPhase} -> ${nextPhase}`);

  return updatedOrder;
};

module.exports = {
  VALID_PHASES,
  NEXT_PHASE_MAP,
  PHASE_PROGRESS_MAP,
  DEFAULT_PHASE_DURATION_MS,
  getPhaseDurationMs,
  getNextPhase,
  shouldAdvancePhase,
  advanceOrderPhase,
};
