const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { buildMinimalPlateView } = require('./plateView.service');

/**
 * Upserts a searched plate entry for a CLIENTE, keeping only the 10 most recent.
 *
 * @param {number} userId
 * @param {string} placa
 */
const recordPlateSearch = async (userId, placa) => {
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.searchedPlate.upsert({
      where: {
        userId_placa: {
          userId,
          placa,
        },
      },
      create: {
        userId,
        placa,
        lastSearchedAt: now,
      },
      update: {
        lastSearchedAt: now,
      },
    });

    const userPlates = await tx.searchedPlate.findMany({
      where: { userId },
      orderBy: { lastSearchedAt: 'desc' },
      select: { id: true },
    });

    if (userPlates.length > 10) {
      const idsToDelete = userPlates.slice(10).map((p) => p.id);
      await tx.searchedPlate.deleteMany({
        where: { id: { in: idsToDelete } },
      });
    }
  });
};

/**
 * Finds the active service order for a plate and builds its minimal plate view.
 * Returns null if the vehicle or an active (undelivered) order does not exist.
 *
 * @param {string} placa
 * @returns {Promise<object|null>}
 */
const findActivePlateView = async (placa) => {
  const vehicle = await prisma.vehicle.findUnique({
    where: { placa },
    include: {
      serviceOrders: {
        where: { deliveredAt: null },
        include: {
          phaseEvents: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        take: 1,
      },
    },
  });

  const activeOrder = vehicle && vehicle.serviceOrders && vehicle.serviceOrders[0];
  if (!activeOrder) {
    return null;
  }

  return await buildMinimalPlateView(vehicle, activeOrder);
};

/**
 * Resolves the public minimal status for a plate, recording search history for CLIENTE users.
 *
 * @param {string} placa
 * @param {object} [user]
 * @returns {Promise<object>}
 */
const getPlateStatus = async (placa, user) => {
  // Side effect for role CLIENTE only: upsert SearchedPlate for ANY validly-formatted plate searched
  if (user && user.rol === 'CLIENTE') {
    await recordPlateSearch(user.id, placa);
  }

  const responseData = await findActivePlateView(placa);
  if (!responseData) {
    throw AppError.notFound('No hay un carro lavándose con esta placa');
  }

  return responseData;
};

module.exports = {
  recordPlateSearch,
  findActivePlateView,
  getPlateStatus,
  buildMinimalPlateView,
};
