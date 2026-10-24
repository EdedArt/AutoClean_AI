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
  color: z
    .string({ required_error: 'Field "color" is required' })
    .trim()
    .min(1, 'Field "color" cannot be empty')
    .max(30, 'Field "color" cannot exceed 30 characters'),
  ownerName: z
    .string({ required_error: 'Field "ownerName" is required' })
    .trim()
    .min(2, 'Field "ownerName" must be at least 2 characters')
    .max(80, 'Field "ownerName" cannot exceed 80 characters'),
  ownerEmail: z
    .string()
    .trim()
    .email('Invalid email format for "ownerEmail"')
    .toLowerCase()
    .optional(),
  nivelSuciedad: z
    .enum(VALID_NIVELES_SUCIEDAD, {
      errorMap: () => ({
        message: `Field "nivelSuciedad" must be one of: ${VALID_NIVELES_SUCIEDAD.join(', ')}`,
      }),
    })
    .optional(),
});

const updateVehicleOwner = z.object({
  ownerEmail: z
    .string({ required_error: 'Field "ownerEmail" is required' })
    .trim()
    .email('Invalid email format for "ownerEmail"')
    .toLowerCase(),
});

module.exports = {
  VALID_NIVELES_SUCIEDAD,
  createVehicle,
  createVehicleSchema: createVehicle,
  updateVehicleOwner,
  updateVehicleOwnerSchema: updateVehicleOwner,
};
