const { z } = require('zod');

const normalizePlacaString = (val) => {
  if (typeof val !== 'string') return val;
  const upper = val.trim().toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(upper)) {
    return `${upper.slice(0, 3)}-${upper.slice(3)}`;
  }
  return upper;
};

const placaSchema = z
  .string({ required_error: 'Field "placa" is required' })
  .trim()
  .transform((val) => normalizePlacaString(val))
  .pipe(
    z.string().regex(/^[A-Z]{3}-\d{3}$/, 'Placa must be in format XXX-123 (three letters, hyphen, three digits)')
  );

const idParam = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'ID must be a number' })
    .int('ID must be an integer')
    .positive('ID must be a positive integer'),
});

const orderIdParam = z.object({
  orderId: z.coerce
    .number({ invalid_type_error: 'Order ID must be a number' })
    .int('Order ID must be an integer')
    .positive('Order ID must be a positive integer'),
});

const placaParam = z.object({
  placa: placaSchema,
});

module.exports = {
  normalizePlacaString,
  placaSchema,
  idParam,
  idParamSchema: idParam,
  orderIdParam,
  orderIdParamSchema: orderIdParam,
  placaParam,
  placaParamSchema: placaParam,
};
