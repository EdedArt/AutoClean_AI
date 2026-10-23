const { rateLimit } = require('express-rate-limit');
const env = require('../config/env');

/**
 * Custom 429 response handler conforming to AutoClean AI unified error format
 */
const rateLimitHandler = (message = 'Too many requests, please try again later.') => {
  return (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message,
      },
    });
  };
};

/**
 * Global rate limiter for /api endpoints.
 * Configured via RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX.
 * Skips /api/health and skips in test mode unless RATE_LIMIT_MAX is specifically configured low.
 */
const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS || 60000,
  limit: () => env.RATE_LIMIT_MAX || 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Never rate limit health check or documentation
    if (
      req.path === '/health' ||
      req.originalUrl === '/api/health' ||
      req.originalUrl.startsWith('/api/docs')
    ) {
      return true;
    }
    // Prevent interference with standard test suites unless specifically testing rate limiting
    if (env.NODE_ENV === 'test' && env.RATE_LIMIT_MAX >= 100) {
      return true;
    }
    return false;
  },
  handler: rateLimitHandler('Too many requests, please try again later.'),
});

/**
 * Stricter rate limiter for photographic evidence uploads (default: 20 req/min).
 */
const evidenceUploadLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS || 60000,
  limit: () => (process.env.RATE_LIMIT_EVIDENCE_MAX ? parseInt(process.env.RATE_LIMIT_EVIDENCE_MAX, 10) : 20),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => {
    if (env.NODE_ENV === 'test' && (!process.env.RATE_LIMIT_EVIDENCE_MAX || parseInt(process.env.RATE_LIMIT_EVIDENCE_MAX, 10) >= 20)) {
      return true;
    }
    return false;
  },
  handler: rateLimitHandler('Too many evidence upload requests, please try again later.'),
});

module.exports = {
  globalLimiter,
  evidenceUploadLimiter,
  rateLimitHandler,
};
