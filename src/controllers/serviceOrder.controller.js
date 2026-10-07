const prisma = require('../config/db');

const VALID_PHASES = ['RECIBIDO', 'LAVADO', 'SECADO', 'LISTO'];

const phaseProgressMap = {
  RECIBIDO: 10,
  LAVADO: 45,
  SECADO: 80,
  LISTO: 100,
};

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

    if (vehicleId === undefined || vehicleId === null) {
      return res.status(400).json({ error: 'Field "vehicleId" is required' });
    }

    const parsedVehicleId = parseInt(vehicleId, 10);
    if (isNaN(parsedVehicleId)) {
      return res.status(400).json({ error: 'Field "vehicleId" must be a valid integer' });
    }

    // Check if vehicle exists
    const vehicleExists = await prisma.vehicle.findUnique({
      where: { id: parsedVehicleId },
    });
    if (!vehicleExists) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    const parsedPackageId =
      packageId !== undefined && packageId !== null && packageId !== ''
        ? parseInt(packageId, 10)
        : null;

    if (parsedPackageId !== null && isNaN(parsedPackageId)) {
      return res.status(400).json({ error: 'Field "packageId" must be a valid integer' });
    }

    const parsedBayId =
      bayId !== undefined && bayId !== null && bayId !== ''
        ? parseInt(bayId, 10)
        : null;

    if (parsedBayId !== null && isNaN(parsedBayId)) {
      return res.status(400).json({ error: 'Field "bayId" must be a valid integer' });
    }

    const newOrder = await prisma.serviceOrder.create({
      data: {
        vehicleId: parsedVehicleId,
        packageId: parsedPackageId,
        bayId: parsedBayId,
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

    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    if (!faseActual || !VALID_PHASES.includes(faseActual)) {
      return res.status(400).json({
        error: `Invalid faseActual. Must be one of: ${VALID_PHASES.join(', ')}`,
      });
    }

    const porcentajeProgreso = phaseProgressMap[faseActual];

    const updatedOrder = await prisma.serviceOrder.update({
      where: { id: orderId },
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
 * Track the latest service order for a given vehicle plate (placa)
 */
const trackOrderByPlaca = async (req, res, next) => {
  try {
    const { placa } = req.params;

    if (!placa || !placa.trim()) {
      return res.status(400).json({ error: 'Parámetro "placa" es requerido' });
    }

    const order = await prisma.serviceOrder.findFirst({
      where: {
        vehicle: {
          placa: placa.trim(),
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

    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getServiceOrders,
  createServiceOrder,
  updateServicePhase,
  trackOrderByPlaca,
};
