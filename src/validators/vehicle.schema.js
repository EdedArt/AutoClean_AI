const { z } = require('zod');
const { placaSchema } = require('./common.schema');

const VALID_NIVELES_SUCIEDAD = ['Leve', 'Moderado', 'Severo'];

const createVehicle = z.object({
  placa: placaSchema,
  marca: z
    .string({ required_error: 'Field "marca" is required' })
    .trim()
    .min(1, 'Field "marca" cannot be empty'),
  modelo: z
    .string({ required_error: 'Field "modelo" is required' })
    .trim()
    .min(1, 'Field "modelo" cannot be empty'),
  nivelSuciedad: z.enum(VALID_NIVELES_SUCIEDAD, {
    errorMap: () => ({
      message: `Field "nivelSuciedad" must be one of: ${VALID_NIVELES_SUCIEDAD.join(', ')}`,
    }),
  }),
});

module.exports = {
  VALID_NIVELES_SUCIEDAD,
  createVehicle,
  createVehicleSchema: createVehicle,
};
