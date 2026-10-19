const { z } = require('zod');
const { VALID_PHASES } = require('../services/simulation.service');

const uploadEvidence = z.object({
  etapa: z
    .string()
    .trim()
    .transform((val) => (val === '' ? undefined : val))
    .pipe(
      z
        .enum(VALID_PHASES, {
          errorMap: () => ({
            message: `Invalid etapa. Must be one of: ${VALID_PHASES.join(', ')}`,
          }),
        })
        .optional()
    )
    .optional(),
});

module.exports = {
  uploadEvidence,
  uploadEvidenceSchema: uploadEvidence,
};
