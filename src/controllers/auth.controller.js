const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Public self-registration (ALWAYS creates role CLIENTE)
 */
const register = asyncHandler(async (req, res) => {
  const { nombre, email, password } = req.body;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new AppError('A user with this email already exists', 409, 'DUPLICATE_RESOURCE');
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  // Self-registration strictly enforces role CLIENTE regardless of input
  const user = await prisma.user.create({
    data: {
      nombre,
      email,
      passwordHash,
      rol: 'CLIENTE',
    },
  });

  const userResponse = {
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    rol: user.rol,
    createdAt: user.createdAt,
  };

  res.status(201).json({
    user: userResponse,
    ...userResponse,
  });
});

/**
 * User login returning JWT token and user profile
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      rol: user.rol,
    },
    env.JWT_SECRET,
    {
      expiresIn: env.JWT_EXPIRES_IN || '1d',
    }
  );

  res.status(200).json({
    token,
    user: {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
    },
  });
});

/**
 * Returns currently authenticated user profile
 */
const getMe = asyncHandler(async (req, res) => {
  const user = req.user;
  const userResponse = {
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    rol: user.rol,
    createdAt: user.createdAt,
  };

  res.status(200).json({
    user: userResponse,
    ...userResponse,
  });
});

module.exports = {
  register,
  login,
  getMe,
};
