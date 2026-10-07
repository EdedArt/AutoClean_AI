const prisma = require('../config/db');

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

module.exports = {
  getServiceOrders,
  createServiceOrder,
};
