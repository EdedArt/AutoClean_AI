require('dotenv').config();
const { z } = require('zod');

const envSchema = z.object({
  PORT: z.coerce
    .number({ invalid_type_error: 'PORT must be a valid integer' })
    .int('PORT must be a valid integer')
    .positive('PORT must be a positive integer')
    .default(3000),
  NODE_ENV: z
    .enum(['development', 'test', 'production'], {
      errorMap: () => ({ message: 'NODE_ENV must be one of: development, test, production' }),
    })
    .default('development'),
  DATABASE_URL: z
    .string({ message: 'DATABASE_URL is required' })
    .min(1, 'DATABASE_URL cannot be empty'),
  SIMULATION_PHASE_DURATION_MS: z.coerce
    .number({ invalid_type_error: 'SIMULATION_PHASE_DURATION_MS must be an integer' })
    .int()
    .positive()
    .default(60000),
  CORS_ORIGINS: z
    .string()
    .default('*'),
  RATE_LIMIT_WINDOW_MS: z.coerce
    .number({ invalid_type_error: 'RATE_LIMIT_WINDOW_MS must be an integer' })
    .int()
    .positive()
    .default(60000),
  RATE_LIMIT_MAX: z.coerce
    .number({ invalid_type_error: 'RATE_LIMIT_MAX must be an integer' })
    .int()
    .positive()
    .default(100),
  JWT_SECRET: z
    .string({ message: 'JWT_SECRET is required' })
    .min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_EXPIRES_IN: z
    .string()
    .default('1d'),
});

/**
 * Validates an environment variables object against envSchema.
 * Exits process with code 1 if validation fails.
 *
 * @param {Record<string, any>} [env=process.env]
 * @param {boolean} [shouldExit=true] - Set to false in tests to return result or throw
 * @returns {z.infer<typeof envSchema>}
 */
function validateEnv(env = process.env, shouldExit = true) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const errorMessages = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || 'variable'}: ${issue.message}`
    );
    const fullMessage = '❌ Invalid environment variables configuration:\n' + errorMessages.join('\n');
    console.error(fullMessage);
    if (shouldExit) {
      process.exit(1);
    }
    const err = new Error(fullMessage);
    err.issues = result.error.issues;
    throw err;
  }
  return result.data;
}

// Perform startup validation
const parsed = validateEnv(process.env, true);

const env = {
  get PORT() {
    return process.env.PORT ? parseInt(process.env.PORT, 10) : parsed.PORT;
  },
  get NODE_ENV() {
    return process.env.NODE_ENV || parsed.NODE_ENV;
  },
  get DATABASE_URL() {
    return process.env.DATABASE_URL || parsed.DATABASE_URL;
  },
  get SIMULATION_PHASE_DURATION_MS() {
    return process.env.SIMULATION_PHASE_DURATION_MS
      ? parseInt(process.env.SIMULATION_PHASE_DURATION_MS, 10)
      : parsed.SIMULATION_PHASE_DURATION_MS;
  },
  get CORS_ORIGINS() {
    return process.env.CORS_ORIGINS !== undefined ? process.env.CORS_ORIGINS : parsed.CORS_ORIGINS;
  },
  get RATE_LIMIT_WINDOW_MS() {
    return process.env.RATE_LIMIT_WINDOW_MS
      ? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10)
      : parsed.RATE_LIMIT_WINDOW_MS;
  },
  get RATE_LIMIT_MAX() {
    return process.env.RATE_LIMIT_MAX
      ? parseInt(process.env.RATE_LIMIT_MAX, 10)
      : parsed.RATE_LIMIT_MAX;
  },
  get JWT_SECRET() {
    return process.env.JWT_SECRET || parsed.JWT_SECRET;
  },
  get JWT_EXPIRES_IN() {
    return process.env.JWT_EXPIRES_IN || parsed.JWT_EXPIRES_IN;
  },
  validateEnv,
  envSchema,
};

module.exports = env;
