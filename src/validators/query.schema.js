const { z } = require('zod');
const { VALID_PHASES } = require('../services/simulation.service');

const pagination = z.object({
  page: z.coerce
    .number({ invalid_type_error: 'Field "page" must be a valid integer' })
    .int('Field "page" must be a valid integer')
    .min(1, 'Field "page" must be at least 1')
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: 'Field "limit" must be a valid integer' })
    .int('Field "limit" must be a valid integer')
    .min(1, 'Field "limit" must be between 1 and 50')
    .max(50, 'Field "limit" must be between 1 and 50')
    .default(10),
});

const vehicleQuery = pagination.extend({
  search: z
    .string()
    .trim()
    .transform((val) => (val === '' ? undefined : val))
    .pipe(
      z
        .string()
        .min(1, 'Field "search" must be at least 1 character')
        .max(20, 'Field "search" must be at most 20 characters')
        .optional()
    )
    .optional(),
});

const orderQuery = pagination.extend({
  placa: z
    .string()
    .trim()
    .transform((val) => (val === '' ? undefined : val.toUpperCase()))
    .optional(),
  fase: z
    .string()
    .trim()
    .transform((val) => (val === '' ? undefined : val))
    .pipe(
      z
        .enum(VALID_PHASES, {
          errorMap: () => ({
            message: `Field "fase" must be one of: ${VALID_PHASES.join(', ')}`,
          }),
        })
        .optional()
    )
    .optional(),
  bayId: z.coerce
    .number({ invalid_type_error: 'Field "bayId" must be a valid integer' })
    .int('Field "bayId" must be a valid integer')
    .positive('Field "bayId" must be a positive integer')
    .optional(),
  activeOnly: z.preprocess((val) => {
    if (val === 'true' || val === true || val === '1' || val === 1) return true;
    if (val === 'false' || val === false || val === '0' || val === 0) return false;
    if (val === '' || val === undefined || val === null) return undefined;
    return val;
  }, z.boolean({ invalid_type_error: 'Field "activeOnly" must be a boolean' }).optional()),
  sort: z.preprocess(
    (val) => (val === '' || val === undefined || val === null ? undefined : val),
    z
      .enum(['newest', 'oldest'], {
        errorMap: () => ({
          message: 'Field "sort" must be either "newest" or "oldest"',
        }),
      })
      .default('newest')
  ),
});

module.exports = {
  pagination,
  vehicleQuery,
  orderQuery,
};
