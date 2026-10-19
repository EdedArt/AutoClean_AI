const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Fetch all vehicles
 */
const getVehicles = asyncHandler(async (req, res) => {
  const vehicles = await prisma.vehicle.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.status(200).json(vehicles);
});

/**
 * Fetch a single vehicle by ID
 */
const getVehicleById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
  });

  if (!vehicle) {
    throw AppError.notFound('Vehicle not found');
  }

  res.status(200).json(vehicle);
});

/**
 * Create a new vehicle
 */
const createVehicle = asyncHandler(async (req, res) => {
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
});

module.exports = {
  getVehicles,
  getVehicleById,
  createVehicle,
};
