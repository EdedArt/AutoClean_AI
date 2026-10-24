class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} [statusCode=500] - HTTP status code
   * @param {string} [code='INTERNAL_ERROR'] - Machine-readable error code
   * @param {Array<{field: string, message: string}>} [details=null] - Optional validation or detail items
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details) {
      if (Array.isArray(details) && details.length > 0) {
        this.details = details;
      } else if (typeof details === 'object' && Object.keys(details).length > 0) {
        this.details = details;
      }
    }
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad Request', code = 'BAD_REQUEST', details = null) {
    return new AppError(message, 400, code, details);
  }

  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new AppError(message, 404, code);
  }

  static conflict(message = 'Conflict', code = 'CONFLICT') {
    return new AppError(message, 409, code);
  }

  static unprocessable(message = 'Unprocessable Entity', code = 'UNPROCESSABLE_ENTITY', details = null) {
    return new AppError(message, 422, code, details);
  }

  static internal(message = 'Internal Server Error', code = 'INTERNAL_ERROR') {
    return new AppError(message, 500, code);
  }
}

module.exports = AppError;
