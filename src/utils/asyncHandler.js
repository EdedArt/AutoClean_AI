/**
 * Wraps an async route handler or middleware to automatically forward
 * rejected promises or uncaught exceptions to Express's next() error handler.
 *
 * @param {Function} fn - Async controller or middleware function
 * @returns {import('express').RequestHandler}
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
