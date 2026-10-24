const { z } = require('zod');

const analyzeBodySchema = z.object({
  scenario: z
    .enum(['wrong_vehicle', 'unreadable', 'regression', 'low_confidence'], {
      errorMap: () => ({
        message: 'Scenario must be one of: wrong_vehicle, unreadable, regression, low_confidence',
      }),
    })
    .optional(),
  saveEvidence: z
    .union([z.boolean(), z.string()])
    .optional()
    .default(true)
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      return val.toLowerCase() === 'true' || val === '1';
    }),
});

const analysesQuerySchema = z.object({
  page: z.coerce
    .number({ invalid_type_error: 'page must be an integer' })
    .int('page must be an integer')
    .min(1, 'page must be at least 1')
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: 'limit must be an integer' })
    .int('limit must be an integer')
    .min(1, 'limit must be at least 1')
    .max(50, 'limit cannot exceed 50')
    .default(10),
});

module.exports = {
  analyzeBodySchema,
  analysesQuerySchema,
};
