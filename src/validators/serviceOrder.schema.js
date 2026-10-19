const { z } = require('zod');
const { VALID_PHASES } = require('../services/simulation.service');

const createOrder = z.object({
  vehicleId: z.coerce
    .number({
      required_error: 'Field "vehicleId" is required',
      invalid_type_error: 'Field "vehicleId" must be a valid integer',
    })
    .int('Field "vehicleId" must be a valid integer')
    .positive('Field "vehicleId" must be a positive integer'),
  packageId: z.coerce
    .number({
      invalid_type_error: 'Field "packageId" must be a valid integer',
    })
    .int('Field "packageId" must be a valid integer')
    .positive('Field "packageId" must be a positive integer')
    .optional()
    .nullable(),
  bayId: z.coerce
    .number({
      invalid_type_error: 'Field "bayId" must be a valid integer',
    })
    .int('Field "bayId" must be a valid integer')
    .positive('Field "bayId" must be a positive integer')
    .optional()
    .nullable(),
});

const updatePhase = z.object({
  faseActual: z.enum(VALID_PHASES, {
    errorMap: () => ({
      message: `Invalid faseActual. Must be one of: ${VALID_PHASES.join(', ')}`,
    }),
  }),
});

module.exports = {
  createOrder,
  createOrderSchema: createOrder,
  updatePhase,
  updatePhaseSchema: updatePhase,
};
