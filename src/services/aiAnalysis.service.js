const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const aiService = require('./ai');

/**
 * Normalizes a license plate by trimming, uppercasing, and removing spaces/hyphens.
 *
 * @param {string|null|undefined} str
 * @returns {string}
 */
function normalizePlate(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Returns current status and capability of the AI vision system.
 * NEVER returns the API key.
 *
 * @returns {object}
 */
const getAiStatus = () => {
  return aiService.getAiStatus();
};

/**
 * Fetches paginated history of AI analysis attempts for a service order.
 *
 * @param {number|string} id
 * @param {object} [query]
 * @returns {Promise<object>}
 */
const getOrderAnalyses = async (id, query = {}) => {
  const orderId = Number(id);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const order = await prisma.serviceOrder.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw AppError.notFound('Service order not found');
  }

  const [total, analyses] = await Promise.all([
    prisma.aiAnalysis.count({
      where: { orderId },
    }),
    prisma.aiAnalysis.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const totalPages = Math.ceil(total / limit) || (total === 0 ? 0 : 1);

  return {
    data: analyses,
    meta: {
      page,
      limit,
      total,
      totalPages,
    },
  };
};

module.exports = {
  normalizePlate,
  getAiStatus,
  getOrderAnalyses,
};
