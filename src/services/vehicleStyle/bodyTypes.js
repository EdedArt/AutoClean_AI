/** Allowed values for Vehicle.bodyType (the column stays null when unknown). */
const BODY_TYPES = Object.freeze(['SEDAN', 'HATCHBACK', 'SUV', 'PICKUP', 'VAN']);

/**
 * @param {unknown} value
 * @returns {value is 'SEDAN'|'HATCHBACK'|'SUV'|'PICKUP'|'VAN'}
 */
function isBodyType(value) {
  return typeof value === 'string' && BODY_TYPES.includes(value);
}

module.exports = {
  BODY_TYPES,
  isBodyType,
};
