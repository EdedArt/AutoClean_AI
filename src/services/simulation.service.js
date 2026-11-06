const prisma = require('../config/db');

const VALID_PHASES = ['PENDIENTE', 'REMOJO', 'LAVADO', 'SECADO', 'POLICHADO', 'LISTO'];

const NEXT_PHASE_MAP = {
  PENDIENTE: 'REMOJO',
  REMOJO: 'LAVADO',
  LAVADO: 'SECADO',
  SECADO: 'LISTO',
  POLICHADO: 'LISTO',
};

const PHASE_PROGRESS_WITHOUT_POLICHADO = {
  PENDIENTE: 10,
  REMOJO: 30,
  LAVADO: 55,
  SECADO: 80,
  LISTO: 100,
};

const PHASE_PROGRESS_WITH_POLICHADO = {
  PENDIENTE: 10,
  REMOJO: 25,
  LAVADO: 45,
  SECADO: 65,
  POLICHADO: 85,
  LISTO: 100,
};

/**
 * Helper to determine if an order, package, or boolean flag indicates polichado.
 * @param {object|boolean|null|undefined} orderOrFlag
 * @returns {boolean}
 */
const doesOrderIncludePolichado = (orderOrFlag) => {
  if (typeof orderOrFlag === 'boolean') return orderOrFlag;
  if (!orderOrFlag || typeof orderOrFlag !== 'object') return false;
  if (typeof orderOrFlag.incluyePolichado === 'boolean') return orderOrFlag.incluyePolichado;
  if (orderOrFlag.package && typeof orderOrFlag.package.incluyePolichado === 'boolean') {
    return orderOrFlag.package.incluyePolichado;
  }
  if (orderOrFlag.paquete && typeof orderOrFlag.paquete.incluyePolichado === 'boolean') {
    return orderOrFlag.paquete.incluyePolichado;
  }
  return false;
};

/**
 * Function that returns the phase progress percentage map depending on whether
 * the package includes polichado. Also exposes the default percentages as properties
 * for backwards compatibility.
 *
 * @param {boolean|object} [orderOrIncluyePolichado=false]
 * @returns {Record<string, number>}
 */
const PHASE_PROGRESS_MAP = Object.assign(
  function getPhaseProgressMap(orderOrIncluyePolichado = false) {
    const hasPolichado = doesOrderIncludePolichado(orderOrIncluyePolichado);
    return hasPolichado
      ? { ...PHASE_PROGRESS_WITH_POLICHADO }
      : { ...PHASE_PROGRESS_WITHOUT_POLICHADO };
  },
  PHASE_PROGRESS_WITHOUT_POLICHADO,
  { POLICHADO: 85 }
);

const PHASE_LABELS = {
  PENDIENTE: 'Pendiente',
  REMOJO: 'Remojo',
  LAVADO: 'Lavando',
  SECADO: 'Secado',
  POLICHADO: 'Polichado',
  LISTO: 'Listo',
};

const PHASE_CATALOG = [
  { code: 'PENDIENTE', label: 'Pendiente', progress: 10, order: 1 },
  { code: 'REMOJO', label: 'Remojo', progress: 30, order: 2 },
  { code: 'LAVADO', label: 'Lavando', progress: 55, order: 3 },
  { code: 'SECADO', label: 'Secado', progress: 80, order: 4 },
  { code: 'LISTO', label: 'Listo', progress: 100, order: 5 },
];

const PHASE_CATALOG_WITH_POLICHADO = [
  { code: 'PENDIENTE', label: 'Pendiente', progress: 10, order: 1 },
  { code: 'REMOJO', label: 'Remojo', progress: 25, order: 2 },
  { code: 'LAVADO', label: 'Lavando', progress: 45, order: 3 },
  { code: 'SECADO', label: 'Secado', progress: 65, order: 4 },
  { code: 'POLICHADO', label: 'Polichado', progress: 85, order: 5 },
  { code: 'LISTO', label: 'Listo', progress: 100, order: 6 },
];

const getPhaseCatalog = (orderOrIncluyePolichado = false) => {
  return doesOrderIncludePolichado(orderOrIncluyePolichado)
    ? PHASE_CATALOG_WITH_POLICHADO
    : PHASE_CATALOG;
};

const PHASE_ESTIMATED_DURATION_MINUTES = {
  PENDIENTE: 0,
  REMOJO: 3,
  ENJABONADO: 8,
  LAVADO: 10,
  SECADO: 7,
  POLICHADO: 240,
  LISTO: 0,
};

const MIN_PHASE_TIME_RATIO = 0.70;

/**
 * Returns estimated duration for a phase in minutes.
 * @param {string} phase
 * @returns {number}
 */
const getEstimatedDurationMinutesForPhase = (phase) => {
  return PHASE_ESTIMATED_DURATION_MINUTES[phase] ?? 0;
};

/**
 * Returns estimated duration for a phase in milliseconds.
 * @param {string} phase
 * @returns {number}
 */
const getEstimatedDurationForPhase = (phase) => {
  return getEstimatedDurationMinutesForPhase(phase) * 60 * 1000;
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
 * When currentPhase is SECADO, advances to POLICHADO if the order's package
 * includes polichado, or directly to LISTO otherwise.
 *
 * @param {string} currentPhase
 * @param {object|boolean} [order]
 * @returns {string|null}
 */
const getNextPhase = (currentPhase, order = null) => {
  if (currentPhase === 'SECADO') {
    return doesOrderIncludePolichado(order) ? 'POLICHADO' : 'LISTO';
  }
  if (currentPhase === 'POLICHADO') {
    return 'LISTO';
  }
  return NEXT_PHASE_MAP[currentPhase] || null;
};

/**
 * Checks whether an order is eligible to advance to the next phase based on elapsed time.
 * @param {object} order
 * @param {number} [now=Date.now()]
 * @param {number} [durationMs]
 * @returns {boolean}
 */
const shouldAdvancePhase = (order, now = Date.now(), durationMs) => {
  if (!order || !order.faseActual || order.faseActual === 'LISTO' || order.deliveredAt) {
    return false;
  }

  if (!order.listoParaLavar) {
    return false;
  }

  const nextPhase = getNextPhase(order.faseActual, order);
  if (!nextPhase) {
    return false;
  }

  let lastChangeTime = NaN;
  if (order.lastPhaseChangeAt) {
    lastChangeTime = new Date(order.lastPhaseChangeAt).getTime();
  } else {
    const eventTime =
      order.phaseEvents && order.phaseEvents.length > 0
        ? new Date(order.phaseEvents[0].createdAt).getTime()
        : NaN;
    const updatedTime = order.updatedAt ? new Date(order.updatedAt).getTime() : NaN;
    if (!isNaN(eventTime) && !isNaN(updatedTime)) {
      lastChangeTime = Math.min(eventTime, updatedTime);
    } else if (!isNaN(eventTime)) {
      lastChangeTime = eventTime;
    } else if (!isNaN(updatedTime)) {
      lastChangeTime = updatedTime;
    } else if (order.createdAt) {
      lastChangeTime = new Date(order.createdAt).getTime();
    }
  }
  if (isNaN(lastChangeTime)) {
    return false;
  }

  const requiredDurationMs =
    durationMs !== undefined
      ? durationMs
      : order.faseActual === 'PENDIENTE'
        ? 0
        : getEstimatedDurationForPhase(order.faseActual) * MIN_PHASE_TIME_RATIO;

  return (now - lastChangeTime) >= requiredDurationMs;
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

  const env = require('../config/env');
  if (env && env.SIMULATION_AUTO_ADVANCE === false) {
    return null;
  }

  let hydratedOrder = order;
  if (order.package === undefined && order.paquete === undefined) {
    const dbOrder = await prisma.serviceOrder.findUnique({
      where: { id: Number(order.id) },
      include: {
        package: true,
        phaseEvents: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (dbOrder) {
      hydratedOrder = {
        ...dbOrder,
        ...order,
        package: dbOrder.package,
        phaseEvents: order.phaseEvents || dbOrder.phaseEvents,
      };
    }
  }

  const now = options.now || Date.now();
  const durationMs = options.durationMs;

  if (!shouldAdvancePhase(hydratedOrder, now, durationMs)) {
    return null;
  }

  const currentPhase = hydratedOrder.faseActual;
  const nextPhase = getNextPhase(currentPhase, hydratedOrder);
  if (!nextPhase) {
    return null;
  }

  const { changePhase } = require('./orderPhase.service');
  const updatedOrder = await changePhase(hydratedOrder.id, nextPhase, {
    source: 'SIMULATION',
    updatedAt: new Date(now),
    lastPhaseChangeAt: hydratedOrder.lastPhaseChangeAt || hydratedOrder.updatedAt,
    durationMs,
  });

  if (!updatedOrder || updatedOrder.advanced === false) {
    return null;
  }

  console.log(`[SIMULATION] Order #${hydratedOrder.id} advanced ${currentPhase} -> ${nextPhase}`);

  return updatedOrder;
};

module.exports = {
  VALID_PHASES,
  NEXT_PHASE_MAP,
  PHASE_PROGRESS_MAP,
  PHASE_PROGRESS_WITHOUT_POLICHADO,
  PHASE_PROGRESS_WITH_POLICHADO,
  PHASE_LABELS,
  PHASE_CATALOG,
  PHASE_CATALOG_WITH_POLICHADO,
  PHASE_ESTIMATED_DURATION_MINUTES,
  MIN_PHASE_TIME_RATIO,
  DEFAULT_PHASE_DURATION_MS,
  doesOrderIncludePolichado,
  getPhaseCatalog,
  getEstimatedDurationMinutesForPhase,
  getEstimatedDurationForPhase,
  getPhaseDurationMs,
  getNextPhase,
  shouldAdvancePhase,
  advanceOrderPhase,
};
