/**
 * Pagination helper utilities for AutoClean AI backend.
 */

/**
 * Calculates Prisma skip and take values based on page and limit.
 *
 * @param {number} page - 1-indexed page number
 * @param {number} limit - Number of records per page
 * @returns {{ skip: number, take: number }}
 */
function getPrismaPagination(page = 1, limit = 10) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.max(1, parseInt(limit, 10) || 10);

  return {
    skip: (safePage - 1) * safeLimit,
    take: safeLimit,
  };
}

/**
 * Builds standard pagination metadata object.
 *
 * @param {number} total - Total matching records count
 * @param {number} page - Current page number
 * @param {number} limit - Limit per page
 * @returns {{ page: number, limit: number, total: number, totalPages: number }}
 */
function buildPaginationMeta(total, page = 1, limit = 10) {
  const safeTotal = Number.isInteger(total) && total >= 0 ? total : 0;
  const safeLimit = Math.max(1, parseInt(limit, 10) || 10);
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const totalPages = Math.ceil(safeTotal / safeLimit);

  return {
    page: safePage,
    limit: safeLimit,
    total: safeTotal,
    totalPages,
  };
}

/**
 * Wraps list data and pagination metadata in standard envelope.
 *
 * @param {Array<any>} data - Array of records
 * @param {number} total - Total matching count
 * @param {number} page - Current page
 * @param {number} limit - Limit per page
 * @returns {{ data: Array<any>, meta: { page: number, limit: number, total: number, totalPages: number } }}
 */
function buildPaginatedResponse(data, total, page = 1, limit = 10) {
  return {
    data: Array.isArray(data) ? data : [],
    meta: buildPaginationMeta(total, page, limit),
  };
}

module.exports = {
  getPrismaPagination,
  buildPaginationMeta,
  buildPaginatedResponse,
};
