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
  } else if (err.code === 'P2002') {
    statusCode = 409;
    code = 'DUPLICATE_RESOURCE';
    const target = err.meta?.target;
    message = target
      ? `A resource with this ${Array.isArray(target) ? target.join(', ') : target} already exists`
      : 'A resource with this identifier already exists';
  } else if (err.code === 'P2025') {
    statusCode = 404;
    code = 'NOT_FOUND';
    message = err.meta?.cause || 'Record not found';
  } else if (err.code === 'P2003') {
    statusCode = 400;
    code = 'INVALID_REFERENCE';
    message = 'Invalid reference: related resource does not exist';
  } else if (
    err.code === 'LIMIT_FILE_SIZE' ||
    (err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE')
  ) {
    statusCode = 413;
    code = 'FILE_TOO_LARGE';
    message = 'File size exceeds maximum allowed limit of 5 MB';
  } else if (err.name === 'MulterError') {
    statusCode = 400;
    code = 'FILE_UPLOAD_ERROR';
    message = err.message;
  } else if (
    err.code === 'INVALID_FILE_TYPE' ||
    (err.message && err.message.includes('Solo se permiten archivos de imagen'))
  ) {
    statusCode = 400;
    code = 'INVALID_FILE_TYPE';
    message = 'Solo se permiten archivos de imagen (JPEG, PNG, WEBP)';
  } else if (
    err instanceof SyntaxError &&
    (err.status === 400 || err.statusCode === 400) &&
    ('body' in err || err.type === 'entity.parse.failed')
  ) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON in request body';
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
