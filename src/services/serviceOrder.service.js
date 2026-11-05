const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { getPrismaPagination, buildPaginatedResponse } = require('../utils/pagination');
const { getOrderOwnershipFilter } = require('../utils/ownership');
const { enrichOrderWithEta } = require('./eta.service');

/**
 * Fetch all service orders with nested vehicle, package, and bay data.
 * Supports filtering by placa, fase, bayId, activeOnly, active, pagination/sort, and role-based ownership.
 *
 * @param {object} query
 * @param {object} user
 * @returns {Promise<object>}
 */
const listServiceOrders = async (
  {
    page = 1,
    limit = 10,
    placa,
    fase,
    bayId,
    activeOnly,
    active,
    sort = 'newest',
  } = {},
  user
) => {
  const andConditions = [];

  const ownershipFilter = getOrderOwnershipFilter(user);
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

  if (typeof active === 'boolean') {
    andConditions.push({
      deliveredAt: active ? null : { not: null },
    });
  } else if (activeOnly) {
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

  const now = new Date();
  const enrichedOrders = await Promise.all(
    orders.map((order) => enrichOrderWithEta(order, { now }))
  );

  return buildPaginatedResponse(enrichedOrders, total, page, limit);
};

/**
 * Create a new service order atomically, checking vehicle, active order, package, and bay occupancy.
 *
 * @param {object} data
 * @param {number} data.vehicleId
 * @param {number} [data.packageId]
 * @param {number} [data.bayId]
 * @returns {Promise<object>}
 */
const createServiceOrder = async ({ vehicleId, packageId, bayId }) => {
  return await prisma.$transaction(async (tx) => {
    // Verify vehicle exists
    const vehicleExists = await tx.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicleExists) {
      throw AppError.notFound('Vehicle not found');
    }

    // Check if vehicle already has an active order
    const activeOrder = await tx.serviceOrder.findFirst({
      where: {
        vehicleId,
        deliveredAt: null,
      },
    });
    if (activeOrder) {
      throw new AppError(
        'Vehicle already has an active service order',
        409,
        'ACTIVE_ORDER_EXISTS',
        { orderId: activeOrder.id, faseActual: activeOrder.faseActual }
      );
    }

    // Verify package exists if provided
    if (packageId) {
      const packageExists = await tx.package.findUnique({
        where: { id: packageId },
      });
      if (!packageExists) {
        throw AppError.notFound('Package not found');
      }
    }

    // Verify bay exists and check occupancy if provided
    if (bayId) {
      const bay = await tx.bay.findUnique({
        where: { id: bayId },
      });
      if (!bay) {
        throw AppError.notFound('Bay not found');
      }
      if (bay.ocupada) {
        throw AppError.conflict('Bay is already occupied', 'BAY_OCCUPIED');
      }
      await tx.bay.update({
        where: { id: bayId },
        data: { ocupada: true },
      });
    }

    const order = await tx.serviceOrder.create({
      data: {
        vehicleId,
        packageId: packageId || null,
        bayId: bayId || null,
        faseActual: 'PENDIENTE',
        porcentajeProgreso: 10,
        listoParaLavar: false,
      },
      include: {
        vehicle: true,
        package: true,
        bay: true,
      },
    });

    await tx.phaseEvent.create({
      data: {
        orderId: order.id,
        fase: 'PENDIENTE',
        progreso: 10,
        source: 'MANUAL',
      },
    });

    return order;
  });
};

module.exports = {
  listServiceOrders,
  createServiceOrder,
};
