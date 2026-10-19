const AppError = require('../utils/AppError');

/**
 * 404 handler for unmatched routes
 */
const notFoundHandler = (req, res, next) => {
  const message = `Route ${req.method} ${req.originalUrl} not found`;
  next(new AppError(message, 404, 'ROUTE_NOT_FOUND'));
};

/**
 * Global centralized Express error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  // Always log the full error to console
  console.error(err);

  let statusCode = err.statusCode || err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Internal Server Error';
  let details = err.details;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (statusCode === 500) {
    code = 'INTERNAL_ERROR';
    message =
      process.env.NODE_ENV === 'production'
        ? 'Internal Server Error'
        : err.message || 'Internal Server Error';
  }

  const responseBody = {
    error: {
      code,
      message,
      ...(details && Array.isArray(details) && details.length > 0 ? { details } : {}),
    },
    ...(process.env.NODE_ENV !== 'production' && err.stack ? { stack: err.stack } : {}),
  };

  res.status(statusCode).json(responseBody);
};

module.exports = {
  notFoundHandler,
  errorHandler,
};
