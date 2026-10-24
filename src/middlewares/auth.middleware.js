const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Verifies JWT from Authorization: Bearer <token>, loads user, and attaches to req.user
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('Authorization token is missing or malformed', 401, 'UNAUTHORIZED');
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    throw new AppError('Authorization token is missing or malformed', 401, 'UNAUTHORIZED');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Authentication token has expired', 401, 'UNAUTHORIZED');
    }
    throw new AppError('Invalid or malformed authentication token', 401, 'UNAUTHORIZED');
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: {
      id: true,
      email: true,
      nombre: true,
      rol: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new AppError('User belonging to this token no longer exists', 401, 'UNAUTHORIZED');
  }

  req.user = user;
  next();
});

/**
 * Restricts access to users having one of the specified roles
 * @param  {...string} roles
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('User is not authenticated', 401, 'UNAUTHORIZED'));
    }

    if (!roles.includes(req.user.rol)) {
      return next(
        new AppError(
          `Role "${req.user.rol}" is not authorized to access this resource`,
          403,
          'FORBIDDEN'
        )
      );
    }

    next();
  };
};

module.exports = {
  authenticate,
  authorize,
};
