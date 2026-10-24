const { z } = require('zod');

const VALID_ROLES = ['OPERARIO', 'CLIENTE'];

const registerSchema = z.object({
  nombre: z
    .string({ required_error: 'Field "nombre" is required' })
    .trim()
    .min(1, 'Field "nombre" cannot be empty'),
  email: z
    .string({ required_error: 'Field "email" is required' })
    .trim()
    .toLowerCase()
    .email('Invalid email address format'),
  password: z
    .string({ required_error: 'Field "password" is required' })
    .min(8, 'Password must be at least 8 characters long'),
  rol: z.string().optional(),
});

const loginSchema = z.object({
  email: z
    .string({ required_error: 'Field "email" is required' })
    .trim()
    .toLowerCase()
    .email('Invalid email address format'),
  password: z
    .string({ required_error: 'Field "password" is required' })
    .min(1, 'Field "password" cannot be empty'),
});

module.exports = {
  VALID_ROLES,
  registerSchema,
  loginSchema,
};
