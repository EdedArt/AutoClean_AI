const jwt = require('jsonwebtoken');
const env = require('../config/env');
const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Public self-registration (ALWAYS creates role CLIENTE)
 */
const register = asyncHandler(async (req, res) => {
  const { nombre, email, password } = req.body;

  const user = await authService.registerUser({ nombre, email, password });

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

  const user = await authService.authenticateUser({ email, password });

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
