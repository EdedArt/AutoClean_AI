const AppError = require('../utils/AppError');
const { doesOrderIncludePolichado } = require('./simulation.service');

const DEFAULT_PHASE_ETA_MINUTES = {
  PENDIENTE: 10,
  REMOJO: 5,
  LAVADO: 15,
  SECADO: 10,
  POLICHADO: 240,
  LISTO: 0,
};

const QUEUE_WAIT_PER_ORDER_MINUTES = 15;
const MAX_QUEUE_WAIT_MINUTES = 120;
const ORDERED_PHASES = ['PENDIENTE', 'REMOJO', 'LAVADO', 'SECADO', 'LISTO'];
const ORDERED_PHASES_WITH_POLICHADO = [
  'PENDIENTE',
  'REMOJO',
  'LAVADO',
  'SECADO',
  'POLICHADO',
  'LISTO',
];

/**
 * Reads configured phase ETA minutes from env or falls back to defaults.
 * @returns {Record<string, number>}
 */
const getPhaseEtaMinutes = () => {
  let overrides;
  try {
    const env = require('../config/env');
    overrides = env.PHASE_ETA_MINUTES;
  } catch (_) {}

  return {
    ...DEFAULT_PHASE_ETA_MINUTES,
    ...(overrides || {}),
  };
};

/**
 * Formats a duration in minutes into a human-readable ETA string.
 * Under 60 min -> "25 min"
 * 60+ min with remaining minutes -> "1 h 30 min"
 * Exact hours -> "2 h"
 *
 * @param {number} minutes
 * @returns {string}
 */
const formatEtaDuration = (minutes) => {
  const mins = Math.max(0, Math.round(minutes));
  if (mins < 60) {
    return `${mins} min`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  if (remainingMins === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${remainingMins} min`;
};

/**
 * Pure calculation of ETA fields based on order parameters.
 * Adds POLICHADO (240 min) ONLY when the order's package has incluyePolichado = true.
 *
 * @param {object} params
 * @param {string} params.faseActual - Current phase of the order
 * @param {boolean} [params.listoParaLavar=true] - Whether the order is ready to wash
 * @param {boolean} [params.incluyePolichado=false] - Whether the package includes polichado
 * @param {object} [params.package] - Optional package object
 * @param {object} [params.paquete] - Optional Spanish alias package object
 * @param {object} [params.order] - Optional order object
 * @param {Date|string|number} [params.referenceTime] - Timestamp of latest phase transition
 * @param {Date|string|number} [params.createdAt] - Order creation timestamp
 * @param {Date|string|null} [params.deliveredAt=null] - Delivery timestamp if delivered
 * @param {number} [params.earlierActiveOrdersCount=0] - Number of earlier active orders not yet LISTO
 * @param {Date|string|number} [params.now=new Date()] - Reference timestamp for calculation
 * @param {Record<string, number>} [params.phaseMinutes] - Phase durations in minutes
 * @returns {{ etaMinutes: number, etaLabel: string, estimatedReadyAt: string|null, deliveredAt: string|null }}
 */
const calculateEta = ({
  faseActual,
  listoParaLavar = true,
  incluyePolichado = false,
  package: pkg,
  paquete,
  order,
  referenceTime,
  createdAt,
  deliveredAt = null,
  earlierActiveOrdersCount = 0,
  now = new Date(),
  phaseMinutes = getPhaseEtaMinutes(),
}) => {
  const formattedDeliveredAt = deliveredAt
    ? (deliveredAt instanceof Date ? deliveredAt.toISOString() : new Date(deliveredAt).toISOString())
    : null;

  if (faseActual === 'LISTO') {
    return {
      etaMinutes: 0,
      etaLabel: 'Listo para entregar',
      estimatedReadyAt: null,
      deliveredAt: formattedDeliveredAt,
    };
  }

  const hasPolichado = Boolean(
    incluyePolichado ||
      doesOrderIncludePolichado(pkg) ||
      doesOrderIncludePolichado(paquete) ||
      doesOrderIncludePolichado(order) ||
      faseActual === 'POLICHADO'
  );

  const sequence = hasPolichado ? ORDERED_PHASES_WITH_POLICHADO : ORDERED_PHASES;
  const currentIdx = sequence.indexOf(faseActual);
  const phasesFromCurrent = currentIdx >= 0 ? sequence.slice(currentIdx) : ['LISTO'];

  const sumPhaseMinutes = phasesFromCurrent.reduce(
    (acc, phase) => acc + (phaseMinutes[phase] ?? DEFAULT_PHASE_ETA_MINUTES[phase] ?? 0),
    0
  );

  const effectiveRefTime = new Date(referenceTime || createdAt || now).getTime();
  const currentTimeMs = new Date(now).getTime();
  const elapsedMinutes = Math.max(0, Math.floor((currentTimeMs - effectiveRefTime) / 60000));

  let remaining = Math.max(1, sumPhaseMinutes - elapsedMinutes);

  // If the order is PENDIENTE and NOT ready (listoParaLavar false), add QUEUE_WAIT_PER_ORDER_MINUTES
  // for each other active order created earlier that is not yet LISTO (cap at 120 minutes).
  const isUnreadyPendiente = faseActual === 'PENDIENTE' && !listoParaLavar;
  if (isUnreadyPendiente) {
    const queueWait = Math.min(
      Math.max(0, earlierActiveOrdersCount) * QUEUE_WAIT_PER_ORDER_MINUTES,
      MAX_QUEUE_WAIT_MINUTES
    );
    remaining += queueWait;
  }

  const etaMinutes = remaining;
  const formattedDuration = formatEtaDuration(etaMinutes);

  let etaLabel;
  if (isUnreadyPendiente) {
    etaLabel = `Pendiente, aprox. ${formattedDuration}`;
  } else {
    etaLabel = `Aprox. ${formattedDuration}`;
  }

  const estimatedReadyAt = new Date(currentTimeMs + etaMinutes * 60000).toISOString();

  return {
    etaMinutes,
    etaLabel,
    estimatedReadyAt,
    deliveredAt: formattedDeliveredAt,
  };
};

/**
 * Computes ETA for a database order, resolving latest PhaseEvent, package polichado flag, and queue count as needed.
 *
 * @param {object} order
 * @param {object} [options]
 * @param {Date} [options.now]
 * @param {number} [options.earlierActiveOrdersCount]
 * @param {Date} [options.referenceTime]
 * @param {boolean} [options.incluyePolichado]
 * @returns {Promise<{ etaMinutes: number, etaLabel: string, estimatedReadyAt: string|null, deliveredAt: string|null }>}
 */
const computeOrderEta = async (order, options = {}) => {
  if (!order) return null;

  const now = options.now || new Date();

  if (order.faseActual === 'LISTO') {
    return calculateEta({
      faseActual: 'LISTO',
      deliveredAt: order.deliveredAt,
      now,
    });
  }

  // Resolve whether the order's package includes polichado
  let incluyePolichado;
  if (options.incluyePolichado !== undefined) {
    incluyePolichado = Boolean(options.incluyePolichado);
  } else if (
    typeof order.incluyePolichado === 'boolean' ||
    order.package !== undefined ||
    order.paquete !== undefined
  ) {
    incluyePolichado = doesOrderIncludePolichado(order);
  } else if (order.packageId) {
    const prisma = require('../config/db');
    const pkg = await prisma.package.findUnique({
      where: { id: order.packageId },
    });
    incluyePolichado = Boolean(pkg?.incluyePolichado);
  } else {
    incluyePolichado = false;
  }

  // Determine reference time (latest PhaseEvent createdAt, fallback createdAt)
  let referenceTime = options.referenceTime;
  if (!referenceTime) {
    if (order.phaseEvents && Array.isArray(order.phaseEvents) && order.phaseEvents.length > 0) {
      const sorted = [...order.phaseEvents].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      referenceTime = sorted[0].createdAt;
    } else if (order.id) {
      const prisma = require('../config/db');
      const latestEvent = await prisma.phaseEvent.findFirst({
        where: { orderId: order.id },
        orderBy: { createdAt: 'desc' },
      });
      referenceTime = latestEvent ? latestEvent.createdAt : order.createdAt;
    } else {
      referenceTime = order.createdAt;
    }
  }

  // Determine earlier active orders count if PENDIENTE and unready
  let earlierActiveOrdersCount = options.earlierActiveOrdersCount;
  if (earlierActiveOrdersCount === undefined && order.faseActual === 'PENDIENTE' && !order.listoParaLavar) {
    if (order.createdAt && order.id) {
      const prisma = require('../config/db');
      earlierActiveOrdersCount = await prisma.serviceOrder.count({
        where: {
          deliveredAt: null,
          faseActual: { not: 'LISTO' },
          createdAt: { lt: order.createdAt },
          id: { not: order.id },
        },
      });
    } else {
      earlierActiveOrdersCount = 0;
    }
  }

  return calculateEta({
    faseActual: order.faseActual,
    listoParaLavar: order.listoParaLavar,
    incluyePolichado,
    referenceTime,
    createdAt: order.createdAt,
    deliveredAt: order.deliveredAt,
    earlierActiveOrdersCount: earlierActiveOrdersCount || 0,
    now,
  });
};

/**
 * Enriches an order object (or plain object) with realistic ETA fields.
 *
 * @param {object} order
 * @param {object} [options]
 * @returns {Promise<object>}
 */
const enrichOrderWithEta = async (order, options = {}) => {
  if (!order) return order;
  const eta = await computeOrderEta(order, options);
  const plainOrder = order.toJSON ? order.toJSON() : { ...order };
  return {
    ...plainOrder,
    ...eta,
  };
};

module.exports = {
  DEFAULT_PHASE_ETA_MINUTES,
  QUEUE_WAIT_PER_ORDER_MINUTES,
  MAX_QUEUE_WAIT_MINUTES,
  ORDERED_PHASES,
  ORDERED_PHASES_WITH_POLICHADO,
  getPhaseEtaMinutes,
  formatEtaDuration,
  calculateEta,
  computeOrderEta,
  enrichOrderWithEta,
};
