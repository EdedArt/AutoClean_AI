const prisma = require('../config/db');
const { getNextPhase, PHASE_PROGRESS_MAP } = require('../services/simulation.service');
const { calculateDeliveryPrediction } = require('../services/prediction.service');

/**
 * Fetch all service orders with nested vehicle, package, and bay data
 */
const getServiceOrders = async (req, res, next) => {
  try {
    const orders = await prisma.serviceOrder.findMany({
      include: {
        vehicle: true,
        package: true,
        bay: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(orders);
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new service order
 */
const createServiceOrder = async (req, res, next) => {
  try {
    const { vehicleId, packageId, bayId } = req.body;

    // Verify vehicle exists
    const vehicleExists = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicleExists) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    // Verify package exists if provided
    if (packageId) {
      const packageExists = await prisma.package.findUnique({
        where: { id: packageId },
      });
      if (!packageExists) {
        return res.status(404).json({ error: 'Package not found' });
      }
    }

    // Verify bay exists and check occupancy if provided
    if (bayId) {
      const bay = await prisma.bay.findUnique({
        where: { id: bayId },
      });
      if (!bay) {
        return res.status(404).json({ error: 'Bay not found' });
      }
      if (bay.ocupada) {
        return res.status(409).json({ error: 'Bay is already occupied' });
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
  } catch (error) {
    next(error);
  }
};

/**
 * Update the service phase of an order and automatically calculate progress percentage
 */
const updateServicePhase = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { faseActual } = req.body;

    const porcentajeProgreso = PHASE_PROGRESS_MAP[faseActual];

    const updatedOrder = await prisma.serviceOrder.update({
      where: { id },
      data: {
        faseActual,
        porcentajeProgreso,
      },
      include: {
        vehicle: true,
        package: true,
        bay: true,
      },
    });

    res.status(200).json(updatedOrder);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Service order not found' });
    }
    next(error);
  }
};

/**
 * AI Delivery Time Prediction endpoint (Simulated)
 * Returns estimated delivery time, deterministic accuracy percentage, and recalculation status
 */
const getOrderPrediction = async (req, res, next) => {
  try {
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
      return res.status(404).json({ error: 'Service order not found' });
    }

    const prediction = calculateDeliveryPrediction(order);
    res.status(200).json(prediction);
  } catch (error) {
    next(error);
  }
};

/**
 * Track the latest service order for a given vehicle plate (placa)
 */
const trackOrderByPlaca = async (req, res, next) => {
  try {
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
      return res.status(404).json({
        error: 'No se encontraron órdenes activas para esta placa',
      });
    }

    const prediction = calculateDeliveryPrediction(order);

    res.status(200).json({
      ...order,
      prediction,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Demo Control: Force immediate advancement to the next phase
 */
const simulateAdvanceOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await prisma.serviceOrder.findUnique({
      where: { id },
    });

    if (!order) {
      return res.status(404).json({ error: 'Service order not found' });
    }

    if (order.faseActual === 'LISTO') {
      console.warn(`[DEMO] Order #${id} force-advance rejected: Order is already completed.`);
      return res.status(400).json({ error: 'Order is already completed.' });
    }

    const currentPhase = order.faseActual;
    const nextPhase = getNextPhase(currentPhase);

    if (!nextPhase) {
      console.warn(`[DEMO] Order #${id} force-advance rejected: Order is already completed.`);
      return res.status(400).json({ error: 'Order is already completed.' });
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
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Service order not found' });
    }
    next(error);
  }
};

/**
 * Demo Control: Reset an order back to RECIBIDO (10%) and restart simulation timer
 */
const simulateResetOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await prisma.serviceOrder.findUnique({
      where: { id },
    });

    if (!order) {
      return res.status(404).json({ error: 'Service order not found' });
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
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Service order not found' });
    }
    next(error);
  }
};

/**
 * Demo Control: Force order directly to LISTO (100%)
 */
const simulateCompleteOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await prisma.serviceOrder.findUnique({
      where: { id },
    });

    if (!order) {
      return res.status(404).json({ error: 'Service order not found' });
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
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Service order not found' });
    }
    next(error);
  }
};

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
