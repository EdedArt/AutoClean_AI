const prisma = require('../config/db');
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

module.exports = {
  listVehicles,
  getVehicleById,
};
