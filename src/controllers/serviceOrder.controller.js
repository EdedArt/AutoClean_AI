const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getNextPhase, PHASE_PROGRESS_MAP } = require('../services/simulation.service');
const { changePhase } = require('../services/orderPhase.service');
const { calculateDeliveryPrediction } = require('../services/prediction.service');
const { getPrismaPagination, buildPaginatedResponse } = require('../utils/pagination');
const { getOrderOwnershipFilter, checkOrderAccess } = require('../utils/ownership');

/**
 * Fetch all service orders with nested vehicle, package, and bay data
 * Supports filtering by placa, fase, bayId, activeOnly, pagination/sort, and role-based ownership.
 */
const getServiceOrders = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    placa,
    fase,
    bayId,
    activeOnly,
    sort = 'newest',
  } = req.query || {};

  const andConditions = [];

  const ownershipFilter = getOrderOwnershipFilter(req.user);
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

  if (activeOnly) {
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

  res.status(200).json(buildPaginatedResponse(orders, total, page, limit));
});

/**
 * Create a new service order
 */
const createServiceOrder = asyncHandler(async (req, res) => {
  const { vehicleId, packageId, bayId } = req.body;

  // Verify vehicle exists
  const vehicleExists = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
  });
  if (!vehicleExists) {
    throw AppError.notFound('Vehicle not found');
  }

  // Verify package exists if provided
  if (packageId) {
    const packageExists = await prisma.package.findUnique({
      where: { id: packageId },
    });
    if (!packageExists) {
      throw AppError.notFound('Package not found');
    }
  }

  // Verify bay exists and check occupancy if provided
  if (bayId) {
    const bay = await prisma.bay.findUnique({
      where: { id: bayId },
    });
    if (!bay) {
      throw AppError.notFound('Bay not found');
    }
    if (bay.ocupada) {
      throw AppError.conflict('Bay is already occupied', 'BAY_OCCUPIED');
    }
  }

  const newOrder = await prisma.serviceOrder.create({
    data: {
      vehicleId,
      packageId: packageId || null,
      bayId: bayId || null,
    },
    include: {
      vehicle: true,
      package: true,
      bay: true,
    },
  });

  res.status(201).json(newOrder);
});

/**
 * Update the service phase of an order and automatically calculate progress percentage
 */
const updateServicePhase = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { faseActual } = req.body;

  const updatedOrder = await changePhase(id, faseActual, { source: 'MANUAL' });

  res.status(200).json(updatedOrder);
});

/**
 * AI Delivery Time Prediction endpoint (Simulated)
 * Returns estimated delivery time, deterministic accuracy percentage, and recalculation status
 */
const getOrderPrediction = asyncHandler(async (req, res) => {
  const { id } = req.params;

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

  checkOrderAccess(order, req.user);

  const prediction = calculateDeliveryPrediction(order);
  res.status(200).json(prediction);
});

/**
 * Track the latest service order for a given vehicle plate (placa)
 */
const trackOrderByPlaca = asyncHandler(async (req, res) => {
  const { placa } = req.params;

  const order = await prisma.serviceOrder.findFirst({
    where: {
      vehicle: {
        placa,
      },
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
    throw AppError.notFound('No se encontraron órdenes activas para esta placa');
  }

  checkOrderAccess(order, req.user, 'No se encontraron órdenes activas para esta placa');

  const prediction = calculateDeliveryPrediction(order);

  res.status(200).json({
    ...order,
    prediction,
  });
});

/**
 * Demo Control: Force immediate advancement to the next phase
 */
const simulateAdvanceOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const order = await prisma.serviceOrder.findUnique({
    where: { id },
  });

  if (!order) {
    throw AppError.notFound('Service order not found');
  }

  if (order.faseActual === 'LISTO') {
    console.warn(`[DEMO] Order #${id} force-advance rejected: Order is already completed.`);
    throw AppError.badRequest('Order is already completed.', 'ORDER_COMPLETED');
  }

  const currentPhase = order.faseActual;
  const nextPhase = getNextPhase(currentPhase);

  if (!nextPhase) {
    console.warn(`[DEMO] Order #${id} force-advance rejected: Order is already completed.`);
    throw AppError.badRequest('Order is already completed.', 'ORDER_COMPLETED');
  }

  const nextProgress = PHASE_PROGRESS_MAP[nextPhase];

  const updatedOrder = await prisma.serviceOrder.update({
    where: { id },
    data: {
      faseActual: nextPhase,
      porcentajeProgreso: nextProgress,
      updatedAt: new Date(),
    },
    include: {
      vehicle: true,
      package: true,
      bay: true,
    },
  });

  console.log(`[DEMO] Order #${id} force-advanced ${currentPhase} -> ${nextPhase}`);
  res.status(200).json(updatedOrder);
});

/**
 * Demo Control: Reset an order back to RECIBIDO (10%) and restart simulation timer
 */
const simulateResetOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const order = await prisma.serviceOrder.findUnique({
    where: { id },
  });

  if (!order) {
    throw AppError.notFound('Service order not found');
  }

  const updatedOrder = await prisma.serviceOrder.update({
    where: { id },
    data: {
      faseActual: 'RECIBIDO',
      porcentajeProgreso: 10,
      updatedAt: new Date(),
    },
    include: {
      vehicle: true,
      package: true,
      bay: true,
    },
  });

  console.log(`[DEMO] Order #${id} reset to RECIBIDO`);
  res.status(200).json(updatedOrder);
});

/**
 * Demo Control: Force order directly to LISTO (100%)
 */
const simulateCompleteOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const order = await prisma.serviceOrder.findUnique({
    where: { id },
  });

  if (!order) {
    throw AppError.notFound('Service order not found');
  }

  const updatedOrder = await prisma.serviceOrder.update({
    where: { id },
    data: {
      faseActual: 'LISTO',
      porcentajeProgreso: 100,
      updatedAt: new Date(),
    },
    include: {
      vehicle: true,
      package: true,
      bay: true,
    },
  });

  console.log(`[DEMO] Order #${id} force-completed`);
  res.status(200).json(updatedOrder);
});

module.exports = {
  getServiceOrders,
  createServiceOrder,
  updateServicePhase,
  trackOrderByPlaca,
  getOrderPrediction,
  simulateAdvanceOrder,
  simulateResetOrder,
  simulateCompleteOrder,
};
