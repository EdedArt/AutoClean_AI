const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const {
  getNextPhase,
  PHASE_LABELS,
  PHASE_PROGRESS_MAP,
  doesOrderIncludePolichado,
} = require('./simulation.service');
const { changePhase } = require('./orderPhase.service');
const { calculateDeliveryPrediction } = require('./prediction.service');
const { getPrismaPagination, buildPaginatedResponse } = require('../utils/pagination');
const { getOrderOwnershipFilter, checkOrderAccess } = require('../utils/ownership');
const { enrichOrderWithEta } = require('./eta.service');

/**
 * Fetch all service orders with nested vehicle, package, and bay data.
 * Supports filtering by placa, fase, bayId, activeOnly, active, pagination/sort, and role-based ownership.
 *
 * @param {object} query
 * @param {object} user
 * @returns {Promise<object>}
 */
const listServiceOrders = async (
  {
    page = 1,
    limit = 10,
    placa,
    fase,
    bayId,
    activeOnly,
    active,
    sort = 'newest',
  } = {},
  user
) => {
  const andConditions = [];

  const ownershipFilter = getOrderOwnershipFilter(user);
  if (Object.keys(ownershipFilter).length > 0) {
    andConditions.push(ownershipFilter);
  }

  if (placa) {
    andConditions.push({
      vehicle: {
        placa: { contains: placa },
      },
    });
  }

  if (fase) {
    andConditions.push({
      faseActual: fase,
    });
  }

  if (bayId) {
    andConditions.push({
      bayId,
    });
  }

  if (typeof active === 'boolean') {
    andConditions.push({
      deliveredAt: active ? null : { not: null },
    });
  } else if (activeOnly) {
    andConditions.push({
      faseActual: { not: 'LISTO' },
    });
  }

  const where = andConditions.length > 0 ? { AND: andConditions } : {};
  const orderBy = { createdAt: sort === 'oldest' ? 'asc' : 'desc' };
  const { skip, take } = getPrismaPagination(page, limit);

  const [orders, total] = await prisma.$transaction([
    prisma.serviceOrder.findMany({
      where,
      include: {
        vehicle: true,
        package: true,
        bay: true,
      },
      orderBy,
      skip,
      take,
    }),
    prisma.serviceOrder.count({ where }),
  ]);

  const now = new Date();
  const enrichedOrders = await Promise.all(
    orders.map((order) => enrichOrderWithEta(order, { now }))
  );

  return buildPaginatedResponse(enrichedOrders, total, page, limit);
};

/**
 * Create a new service order atomically, checking vehicle, active order, package, and bay occupancy.
 *
 * @param {object} data
 * @param {number} data.vehicleId
 * @param {number} [data.packageId]
 * @param {number} [data.bayId]
 * @returns {Promise<object>}
 */
const createServiceOrder = async ({ vehicleId, packageId, bayId }) => {
  return await prisma.$transaction(async (tx) => {
    // Verify vehicle exists
    const vehicleExists = await tx.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicleExists) {
      throw AppError.notFound('Vehicle not found');
    }

    // Check if vehicle already has an active order
    const activeOrder = await tx.serviceOrder.findFirst({
      where: {
        vehicleId,
        deliveredAt: null,
      },
    });
    if (activeOrder) {
      throw new AppError(
        'Vehicle already has an active service order',
        409,
        'ACTIVE_ORDER_EXISTS',
        { orderId: activeOrder.id, faseActual: activeOrder.faseActual }
      );
    }

    // Verify package exists if provided
    let packageExists = null;
    if (packageId) {
      packageExists = await tx.package.findUnique({
        where: { id: packageId },
      });
      if (!packageExists) {
        throw AppError.notFound('Package not found');
      }
    }

    // Verify bay exists and check occupancy if provided
    if (bayId) {
      const bay = await tx.bay.findUnique({
        where: { id: bayId },
      });
      if (!bay) {
        throw AppError.notFound('Bay not found');
      }
      if (bay.ocupada) {
        throw AppError.conflict('Bay is already occupied', 'BAY_OCCUPIED');
      }
      await tx.bay.update({
        where: { id: bayId },
        data: { ocupada: true },
      });
    }

    const initialProgress = PHASE_PROGRESS_MAP(doesOrderIncludePolichado(packageExists)).PENDIENTE;

    const order = await tx.serviceOrder.create({
      data: {
        vehicleId,
        packageId: packageId || null,
        bayId: bayId || null,
        faseActual: 'PENDIENTE',
        porcentajeProgreso: initialProgress,
        listoParaLavar: false,
      },
      include: {
        vehicle: true,
        package: true,
        bay: true,
      },
    });

    await tx.phaseEvent.create({
      data: {
        orderId: order.id,
        fase: 'PENDIENTE',
        progreso: initialProgress,
        source: 'MANUAL',
      },
    });

    return order;
  });
};

/**
 * Update the service phase of an order manually.
 *
 * @param {number|string} id
 * @param {string} faseActual
 * @returns {Promise<object>}
 */
const updateServicePhase = async (id, faseActual) => {
  return await changePhase(id, faseActual, { source: 'MANUAL' });
};

/**
 * AI Delivery Time Prediction (Simulated) with ownership check.
 *
 * @param {number} id
 * @param {object} user
 * @returns {Promise<object>}
 */
const getOrderPrediction = async (id, user) => {
  const order = await prisma.serviceOrder.findUnique({
    where: { id },
    include: {
      vehicle: true,
      package: true,
      bay: true,
    },
  });

  if (!order) {
    throw AppError.notFound('Service order not found');
  }

  checkOrderAccess(order, user);

  return calculateDeliveryPrediction(order);
};

/**
 * Track the latest active service order for a given vehicle plate (placa) with ownership check.
 *
 * @param {string} placa
 * @param {object} user
 * @returns {Promise<object>}
 */
const trackOrderByPlaca = async (placa, user) => {
  const order = await prisma.serviceOrder.findFirst({
    where: {
      vehicle: {
        placa,
      },
      deliveredAt: null,
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      vehicle: true,
      package: true,
      bay: true,
    },
  });

  if (!order) {
    throw AppError.notFound('No hay un carro lavándose con esta placa');
  }

  checkOrderAccess(order, user, 'No hay un carro lavándose con esta placa');

  const prediction = calculateDeliveryPrediction(order);
  const enrichedOrder = await enrichOrderWithEta(order);

  return {
    ...enrichedOrder,
    prediction,
  };
};

/**
 * Demo Control: Force immediate advancement to the next phase.
 *
 * @param {number|string} id
 * @returns {Promise<object>}
 */
const simulateAdvanceOrder = async (id) => {
  const order = await prisma.serviceOrder.findUnique({
    where: { id: Number(id) },
    include: {
      package: true,
    },
  });

  if (!order) {
    throw AppError.notFound('Service order not found');
  }

  if (order.deliveredAt) {
    throw AppError.conflict('Order is already delivered', 'ALREADY_DELIVERED');
  }

  if (order.faseActual === 'LISTO') {
    console.warn(`[DEMO] Order #${id} force-advance rejected: Order is already completed.`);
    throw AppError.badRequest('Order is already completed.', 'ORDER_COMPLETED');
  }

  const currentPhase = order.faseActual;
  const nextPhase = getNextPhase(currentPhase, order);

  if (!nextPhase) {
    console.warn(`[DEMO] Order #${id} force-advance rejected: Order is already completed.`);
    throw AppError.badRequest('Order is already completed.', 'ORDER_COMPLETED');
  }

  const updatedOrder = await changePhase(id, nextPhase, { source: 'DEMO' });

  console.log(`[DEMO] Order #${id} force-advanced ${currentPhase} -> ${nextPhase}`);
  return updatedOrder;
};

/**
 * Demo Control: Reset an order back to PENDIENTE (10%) and restart simulation timer.
 *
 * @param {number|string} id
 * @returns {Promise<object>}
 */
const simulateResetOrder = async (id) => {
  const updatedOrder = await changePhase(id, 'PENDIENTE', { source: 'DEMO' });

  console.log(`[DEMO] Order #${id} reset to PENDIENTE`);
  return updatedOrder;
};

/**
 * Demo Control: Force order directly to LISTO (100%).
 *
 * @param {number|string} id
 * @returns {Promise<object>}
 */
const simulateCompleteOrder = async (id) => {
  const updatedOrder = await changePhase(id, 'LISTO', { source: 'DEMO' });

  console.log(`[DEMO] Order #${id} force-completed`);
  return updatedOrder;
};

/**
 * Mark a service order as ready to wash (OPERARIO only).
 *
 * @param {number|string} id
 * @returns {Promise<object>}
 */
const markOrderReady = async (id) => {
  const orderId = Number(id);

  const order = await prisma.serviceOrder.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw AppError.notFound('Service order not found');
  }

  if (order.deliveredAt) {
    throw AppError.conflict('Order is already delivered', 'ALREADY_DELIVERED');
  }

  if (order.faseActual !== 'PENDIENTE') {
    throw AppError.conflict('Order must be in PENDIENTE phase to mark as ready', 'INVALID_STATE');
  }

  if (order.listoParaLavar) {
    throw AppError.conflict('Order is already marked as ready to wash', 'ALREADY_READY');
  }

  const now = new Date();
  const updatedOrder = await prisma.serviceOrder.update({
    where: { id: orderId },
    data: {
      listoParaLavar: true,
      readyAt: now,
      updatedAt: now,
    },
    include: {
      vehicle: true,
      package: true,
      bay: true,
    },
  });

  console.log(`[READY] Order #${id} is now ready to wash`);
  return updatedOrder;
};

/**
 * Deliver a service order (OPERARIO only).
 * Sets deliveredAt = now if order is in LISTO phase and not already delivered.
 *
 * @param {number|string} id
 * @returns {Promise<object>}
 */
const deliverServiceOrder = async (id) => {
  const orderId = Number(id);

  const order = await prisma.serviceOrder.findUnique({
    where: { id: orderId },
    include: {
      vehicle: true,
      package: true,
      bay: true,
    },
  });

  if (!order) {
    throw AppError.notFound('Service order not found');
  }

  if (order.deliveredAt) {
    throw AppError.conflict('Order is already delivered', 'ALREADY_DELIVERED');
  }

  if (order.faseActual !== 'LISTO') {
    throw AppError.conflict('Order cannot be delivered until it reaches LISTO phase', 'NOT_FINISHED');
  }

  const now = new Date();
  const updateResult = await prisma.serviceOrder.updateMany({
    where: {
      id: orderId,
      deliveredAt: null,
      faseActual: 'LISTO',
    },
    data: {
      deliveredAt: now,
      updatedAt: now,
    },
  });

  if (updateResult.count === 0) {
    const currentOrder = await prisma.serviceOrder.findUnique({
      where: { id: orderId },
    });

    if (currentOrder?.deliveredAt) {
      throw AppError.conflict('Order is already delivered', 'ALREADY_DELIVERED');
    }

    if (currentOrder?.faseActual !== 'LISTO') {
      throw AppError.conflict('Order cannot be delivered until it reaches LISTO phase', 'NOT_FINISHED');
    }

    throw AppError.conflict('Order is already delivered', 'ALREADY_DELIVERED');
  }

  return await prisma.serviceOrder.findUnique({
    where: { id: orderId },
    include: {
      vehicle: true,
      package: true,
      bay: true,
    },
  });
};

/**
 * Get timeline events of a service order with ownership check.
 *
 * @param {number|string} id
 * @param {object} user
 * @returns {Promise<Array<object>>}
 */
const getOrderTimeline = async (id, user) => {
  const orderId = Number(id);

  const order = await prisma.serviceOrder.findUnique({
    where: { id: orderId },
    include: {
      vehicle: true,
    },
  });

  if (!order) {
    throw AppError.notFound('Service order not found');
  }

  checkOrderAccess(order, user);

  const events = await prisma.phaseEvent.findMany({
    where: { orderId },
    orderBy: { createdAt: 'asc' },
  });

  const timeline = events.map((event) => ({
    id: event.id,
    orderId: event.orderId,
    fase: event.fase,
    label: PHASE_LABELS[event.fase] || event.fase,
    progreso: event.progreso,
    source: event.source,
    createdAt: event.createdAt,
  }));

  if (order.deliveredAt) {
    timeline.push({
      type: 'DELIVERED',
      at: order.deliveredAt,
    });
  }

  return timeline;
};

module.exports = {
  listServiceOrders,
  createServiceOrder,
  updateServicePhase,
  markOrderReady,
  getOrderTimeline,
  trackOrderByPlaca,
  getOrderPrediction,
  simulateAdvanceOrder,
  simulateResetOrder,
  simulateCompleteOrder,
  deliverServiceOrder,
};
