const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { buildMinimalPlateView } = require('../services/plateView.service');

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
 * GET /api/plates/:placa/status
 * Public minimal view for any authenticated user.
 */
const getPlateStatus = asyncHandler(async (req, res) => {
  const { placa } = req.params;

  // Side effect for role CLIENTE only: upsert SearchedPlate for ANY validly-formatted plate searched
  if (req.user && req.user.rol === 'CLIENTE') {
    await recordPlateSearch(req.user.id, placa);
  }

  // Find vehicle and its ACTIVE order (deliveredAt null)
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
    throw AppError.notFound('No hay un carro lavándose con esta placa');
  }

  const responseData = await buildMinimalPlateView(vehicle, activeOrder);
  res.status(200).json(responseData);
});

module.exports = {
  recordPlateSearch,
  buildMinimalPlateView,
  getPlateStatus,
};
