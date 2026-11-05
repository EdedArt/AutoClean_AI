const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { getPrismaPagination, buildPaginatedResponse } = require('../utils/pagination');
const { getVehicleOwnershipFilter, checkVehicleAccess } = require('../utils/ownership');

/**
 * Fetch all vehicles with search, pagination and role-based ownership filtering
 *
 * @param {object} params
 * @param {number} [params.page=1]
 * @param {number} [params.limit=10]
 * @param {string} [params.search]
 * @param {object} user
 * @returns {Promise<object>}
 */
const listVehicles = async ({ page = 1, limit = 10, search } = {}, user) => {
  const andConditions = [];

  const ownershipFilter = getVehicleOwnershipFilter(user);
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

  return buildPaginatedResponse(vehicles, total, page, limit);
};

/**
 * Fetch a single vehicle by ID with ownership verification
 *
 * @param {number} id
 * @param {object} user
 * @returns {Promise<object>}
 */
const getVehicleById = async (id, user) => {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
  });

  checkVehicleAccess(vehicle, user);

  return vehicle;
};

/**
 * Create a new vehicle, optionally linking to a CLIENTE owner by email
 *
 * @param {object} data
 * @returns {Promise<object>}
 */
const createVehicle = async ({ placa, marca, modelo, color, ownerName, ownerEmail, nivelSuciedad }) => {
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

  return await prisma.vehicle.create({
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
};

/**
 * Link or update vehicle owner by client email
 *
 * @param {number} id
 * @param {string} ownerEmail
 * @returns {Promise<object>}
 */
const updateVehicleOwner = async (id, ownerEmail) => {
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

  return await prisma.vehicle.update({
    where: { id },
    data: {
      ownerId: ownerUser.id,
    },
  });
};

module.exports = {
  listVehicles,
  getVehicleById,
  createVehicle,
  updateVehicleOwner,
};
