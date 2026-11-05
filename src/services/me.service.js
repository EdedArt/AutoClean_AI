const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { findActivePlateView } = require('./plate.service');

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
      const status = await findActivePlateView(entry.placa);
      if (!status) {
        return {
          placa: entry.placa,
          lastSearchedAt: entry.lastSearchedAt.toISOString(),
          status: null,
          message: 'No hay un carro lavándose con esta placa',
        };
      }

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
