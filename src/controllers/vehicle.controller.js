const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getPrismaPagination, buildPaginatedResponse } = require('../utils/pagination');

/**
 * Fetch all vehicles with search and pagination support
 */
const getVehicles = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search } = req.query || {};

  const where = {};
  if (search) {
    where.OR = [
      { placa: { contains: search } },
      { marca: { contains: search } },
      { modelo: { contains: search } },
    ];
  }

  const { skip, take } = getPrismaPagination(page, limit);

  const [vehicles, total] = await prisma.$transaction([
    prisma.vehicle.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.vehicle.count({ where }),
  ]);

  res.status(200).json(buildPaginatedResponse(vehicles, total, page, limit));
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
