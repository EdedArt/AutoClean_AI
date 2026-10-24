const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getPrismaPagination, buildPaginatedResponse } = require('../utils/pagination');
const { getVehicleOwnershipFilter, checkVehicleAccess } = require('../utils/ownership');

/**
 * Fetch all vehicles with search, pagination and role-based ownership filtering
 */
const getVehicles = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search } = req.query || {};

  const andConditions = [];

  const ownershipFilter = getVehicleOwnershipFilter(req.user);
  if (Object.keys(ownershipFilter).length > 0) {
    andConditions.push(ownershipFilter);
  }

  if (search) {
    andConditions.push({
      OR: [
        { placa: { contains: search } },
        { marca: { contains: search } },
        { modelo: { contains: search } },
      ],
    });
  }

  const where = andConditions.length > 0 ? { AND: andConditions } : {};
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
 * Fetch a single vehicle by ID with ownership verification
 */
const getVehicleById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
  });

  checkVehicleAccess(vehicle, req.user);

  res.status(200).json(vehicle);
});

/**
 * Create a new vehicle
 */
const createVehicle = asyncHandler(async (req, res) => {
  const { placa, marca, modelo, color, ownerName, ownerEmail, nivelSuciedad } = req.body;

  let ownerId = null;
  if (ownerEmail) {
    const normalizedEmail = ownerEmail.toLowerCase().trim();
    const ownerUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!ownerUser) {
      throw AppError.notFound('Owner user not found', 'OWNER_NOT_FOUND');
    }

    if (ownerUser.rol !== 'CLIENTE') {
      throw AppError.badRequest('Owner user must have CLIENTE role', 'INVALID_OWNER');
    }

    ownerId = ownerUser.id;
  }

  const newVehicle = await prisma.vehicle.create({
    data: {
      placa,
      marca,
      modelo,
      color,
      ownerName,
      ownerId,
      nivelSuciedad: nivelSuciedad || null,
    },
  });

  res.status(201).json(newVehicle);
});

/**
 * Link or update vehicle owner by client email
 */
const updateVehicleOwner = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { ownerEmail } = req.body;

  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
  });

  if (!vehicle) {
    throw AppError.notFound('Vehicle not found');
  }

  const normalizedEmail = ownerEmail.toLowerCase().trim();
  const ownerUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!ownerUser) {
    throw AppError.notFound('Owner user not found', 'OWNER_NOT_FOUND');
  }

  if (ownerUser.rol !== 'CLIENTE') {
    throw AppError.badRequest('Owner user must have CLIENTE role', 'INVALID_OWNER');
  }

  const updatedVehicle = await prisma.vehicle.update({
    where: { id },
    data: {
      ownerId: ownerUser.id,
    },
  });

  res.status(200).json(updatedVehicle);
});

module.exports = {
  getVehicles,
  getVehicleById,
  createVehicle,
  updateVehicleOwner,
};
