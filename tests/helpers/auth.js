const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const http = require('http');
const defaultPrisma = require('../../src/config/db');
const env = require('../../src/config/env');

const DEMO_PASSWORD = 'Demo12345!';

/**
 * Ensures demo users exist in the database (idempotent upsert).
 * @param {import('@prisma/client').PrismaClient} [prisma]
 */
async function ensureDemoUsers(prisma = defaultPrisma) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const operario = await prisma.user.upsert({
    where: { email: 'operario@autoclean.com' },
    update: {
      passwordHash,
      nombre: 'Operario Demo',
      rol: 'OPERARIO',
    },
    create: {
      email: 'operario@autoclean.com',
      passwordHash,
      nombre: 'Operario Demo',
      rol: 'OPERARIO',
    },
  });

  const cliente = await prisma.user.upsert({
    where: { email: 'cliente@autoclean.com' },
    update: {
      passwordHash,
      nombre: 'Cliente Demo',
      rol: 'CLIENTE',
    },
    create: {
      email: 'cliente@autoclean.com',
      passwordHash,
      nombre: 'Cliente Demo',
      rol: 'CLIENTE',
    },
  });

  return { operario, cliente };
}

/**
 * Generates valid JWT token for a user.
 */
function generateToken(user, jwtSecret = env.JWT_SECRET) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      rol: user.rol,
    },
    jwtSecret,
    { expiresIn: '1d' }
  );
}

/**
 * Returns Authorization header with Bearer token for OPERARIO
 */
async function getOperatorAuthHeaders(prisma = defaultPrisma, jwtSecret = env.JWT_SECRET) {
  const { operario } = await ensureDemoUsers(prisma);
  const token = generateToken(operario, jwtSecret);
  return { Authorization: `Bearer ${token}` };
}

/**
 * Returns Authorization header with Bearer token for CLIENTE
 */
async function getClientAuthHeaders(prisma = defaultPrisma, jwtSecret = env.JWT_SECRET) {
  const { cliente } = await ensureDemoUsers(prisma);
  const token = generateToken(cliente, jwtSecret);
  return { Authorization: `Bearer ${token}` };
}

/**
 * Authenticate via HTTP POST /api/auth/login against a running server
 */
function loginViaHttp(port, email = 'operario@autoclean.com', password = DEMO_PASSWORD) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ email, password });
    const options = {
      hostname: 'localhost',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200 && parsed.token) {
            resolve({
              token: parsed.token,
              headers: { Authorization: `Bearer ${parsed.token}` },
              user: parsed.user,
            });
          } else {
            reject(new Error(`Login failed with status ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = {
  DEMO_PASSWORD,
  ensureDemoUsers,
  generateToken,
  getOperatorAuthHeaders,
  getClientAuthHeaders,
  loginViaHttp,
};
