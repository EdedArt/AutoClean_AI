const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const AppError = require('../utils/AppError');

/**
 * Register a new user with role CLIENTE
 *
 * @param {object} params
 * @param {string} params.nombre
 * @param {string} params.email
 * @param {string} params.password
 * @returns {Promise<object>} Created user record
 */
const registerUser = async ({ nombre, email, password }) => {
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new AppError('A user with this email already exists', 409, 'DUPLICATE_RESOURCE');
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const user = await prisma.user.create({
    data: {
      nombre,
      email,
      passwordHash,
      rol: 'CLIENTE',
    },
  });

  return user;
};

/**
 * Authenticate user credentials
 *
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.password
 * @returns {Promise<object>} Authenticated user record
 */
const authenticateUser = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  return user;
};

module.exports = {
  registerUser,
  authenticateUser,
};
