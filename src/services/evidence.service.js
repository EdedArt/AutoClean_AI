const prisma = require('../config/db');
const AppError = require('../utils/AppError');

/**
 * Fetch all evidences for a specific service order (OPERARIO only).
 *
 * @param {number} orderId
 * @param {object} user
 * @returns {Promise<Array<object>>}
 */
const getEvidencesByOrder = async (orderId, user) => {
  if (user && user.rol !== 'OPERARIO') {
    throw AppError.forbidden('Only operators can view photo evidence');
  }

  const order = await prisma.serviceOrder.findUnique({
    where: { id: orderId },
    include: {
      vehicle: true,
    },
  });

  if (!order) {
    throw AppError.notFound('Service order not found');
  }

  return await prisma.evidence.findMany({
    where: { serviceOrderId: orderId },
    orderBy: { createdAt: 'desc' },
  });
};

module.exports = {
  getEvidencesByOrder,
};
