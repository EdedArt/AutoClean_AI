const AppError = require('./AppError');

/**
 * Checks if the user is an operator
 * @param {object} user
 * @returns {boolean}
 */
const isOperator = (user) => {
  return Boolean(user && user.rol === 'OPERARIO');
};

/**
 * Checks if the user is a client
 * @param {object} user
 * @returns {boolean}
 */
const isClient = (user) => {
  return Boolean(user && user.rol === 'CLIENTE');
};

/**
 * Returns a Prisma where clause filter for vehicles based on the user's role.
 * Operators see all vehicles, while clients only see vehicles they own.
 * @param {object} user - The authenticated user (req.user)
 * @returns {object} Prisma where condition
 */
const getVehicleOwnershipFilter = (user) => {
  if (isClient(user)) {
    return { ownerId: user.id };
  }
  return {};
};

/**
 * Returns a Prisma where clause filter for service orders based on the user's role.
 * Operators see all orders, while clients only see orders for vehicles they own.
 * @param {object} user - The authenticated user (req.user)
 * @returns {object} Prisma where condition
 */
const getOrderOwnershipFilter = (user) => {
  if (isClient(user)) {
    return { vehicle: { ownerId: user.id } };
  }
  return {};
};

/**
 * Verifies that a client user owns the specified vehicle.
 * If user is an operator, access is granted.
 * If user is a client and doesn't own the vehicle, throws 404 NOT_FOUND
 * to prevent leaking the existence of other clients' vehicles.
 * @param {object} vehicle - The vehicle database record
 * @param {object} user - The authenticated user (req.user)
 */
const checkVehicleAccess = (vehicle, user) => {
  if (!vehicle) {
    throw AppError.notFound('Vehicle not found');
  }
  if (isClient(user) && vehicle.ownerId !== user.id) {
    throw AppError.notFound('Vehicle not found');
  }
};

/**
 * Verifies that a client user owns the vehicle associated with a service order.
 * If user is an operator, access is granted.
 * If user is a client and doesn't own the order's vehicle, throws 404 NOT_FOUND.
 * @param {object} order - The service order record (must include vehicle)
 * @param {object} user - The authenticated user (req.user)
 * @param {string} notFoundMessage - Custom 404 message
 */
const checkOrderAccess = (order, user, notFoundMessage = 'Service order not found') => {
  if (!order) {
    throw AppError.notFound(notFoundMessage);
  }
  if (isClient(user)) {
    const ownerId = order.vehicle ? order.vehicle.ownerId : null;
    if (ownerId !== user.id) {
      throw AppError.notFound(notFoundMessage);
    }
  }
};

module.exports = {
  isOperator,
  isClient,
  getVehicleOwnershipFilter,
  getOrderOwnershipFilter,
  checkVehicleAccess,
  checkOrderAccess,
};
