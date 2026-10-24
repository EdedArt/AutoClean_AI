const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { computeOrderEta } = require('../services/eta.service');

/**
 * GET /api/me/plates
 * Search history for CLIENTE (ordered by lastSearchedAt desc, max 10).
 * Does not update lastSearchedAt.
 */
const getMyPlates = asyncHandler(async (req, res) => {
  const searchedPlates = await prisma.searchedPlate.findMany({
    where: { userId: req.user.id },
    orderBy: { lastSearchedAt: 'desc' },
    take: 10,
  });

  const data = await Promise.all(
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

      const eta = await computeOrderEta(activeOrder);
      const status = {
        placa: vehicle.placa,
        marca: vehicle.marca,
        modelo: vehicle.modelo,
        color: vehicle.color,
        fase: activeOrder.faseActual,
        porcentajeProgreso: activeOrder.porcentajeProgreso,
        listoParaLavar: activeOrder.listoParaLavar,
        startedAt: activeOrder.readyAt ? activeOrder.readyAt.toISOString() : null,
        receivedAt: activeOrder.createdAt ? activeOrder.createdAt.toISOString() : null,
        etaMinutes: eta.etaMinutes,
        etaLabel: eta.etaLabel,
        estimatedReadyAt: eta.estimatedReadyAt,
      };

      return {
        placa: entry.placa,
        lastSearchedAt: entry.lastSearchedAt.toISOString(),
        status,
      };
    })
  );

  res.status(200).json({ data });
});

/**
 * DELETE /api/me/plates/:placa
 * Delete plate from user's search history.
 */
const deleteMyPlate = asyncHandler(async (req, res) => {
  const { placa } = req.params;

  const existing = await prisma.searchedPlate.findUnique({
    where: {
      userId_placa: {
        userId: req.user.id,
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

  res.status(204).send();
});

module.exports = {
  getMyPlates,
  deleteMyPlate,
};
