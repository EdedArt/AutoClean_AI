const prisma = require('../config/db');

/**
 * Fetch all vehicles
 */
const getVehicles = async (req, res, next) => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(vehicles);
  } catch (error) {
    next(error);
  }
};

/**
 * Fetch a single vehicle by ID
 */
const getVehicleById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
    });

    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    res.status(200).json(vehicle);
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new vehicle
 */
const createVehicle = async (req, res, next) => {
  try {
    const { placa, marca, modelo, nivelSuciedad } = req.body;

    const newVehicle = await prisma.vehicle.create({
      data: {
        placa,
        marca,
        modelo,
        nivelSuciedad,
      },
    });

    res.status(201).json(newVehicle);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A vehicle with this placa already exists' });
    }
    next(error);
  }
};

module.exports = {
  getVehicles,
  getVehicleById,
  createVehicle,
};
