const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { buildMinimalPlateView } = require('./plateView.service');

/**
 * Fetch plate search history for a user (ordered by lastSearchedAt desc, max 10)
 *
 * @param {number} userId
 * @returns {Promise<Array<object>>}
 */
const getSearchHistory = async (userId) => {
  const searchedPlates = await prisma.searchedPlate.findMany({
    where: { userId },
    orderBy: { lastSearchedAt: 'desc' },
    take: 10,
  });

  return await Promise.all(
    searchedPlates.map(async (entry) => {
      const vehicle = await prisma.vehicle.findUnique({
        where: { placa: entry.placa },
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
        return {
          placa: entry.placa,
          lastSearchedAt: entry.lastSearchedAt.toISOString(),
          status: null,
          message: 'No hay un carro lavándose con esta placa',
        };
      }

      const status = await buildMinimalPlateView(vehicle, activeOrder);

      return {
        placa: entry.placa,
        lastSearchedAt: entry.lastSearchedAt.toISOString(),
        status,
      };
    })
  );
};

/**
 * Delete a plate entry from user's search history
 *
 * @param {number} userId
 * @param {string} placa
 * @returns {Promise<void>}
 */
const deleteSearchHistoryPlate = async (userId, placa) => {
  const existing = await prisma.searchedPlate.findUnique({
    where: {
      userId_placa: {
        userId,
        placa,
      },
    },
  });

  if (!existing) {
    throw AppError.notFound('Placa not found in search history');
  }

  await prisma.searchedPlate.delete({
    where: { id: existing.id },
  });
};

module.exports = {
  getSearchHistory,
  deleteSearchHistoryPlate,
};
