require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const env = require('./src/config/env');
const helmet = require('helmet');
const prisma = require('./src/config/db');
const { advanceOrderPhase } = require('./src/services/simulation.service');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./src/config/swagger');
const healthRoutes = require('./src/routes/health.routes');
const vehicleRoutes = require('./src/routes/vehicle.routes');
const bayRoutes = require('./src/routes/bay.routes');
const packageRoutes = require('./src/routes/package.routes');
const serviceOrderRoutes = require('./src/routes/serviceOrder.routes');
const evidenceRoutes = require('./src/routes/evidence.routes');
const authRoutes = require('./src/routes/auth.routes');
const phaseRoutes = require('./src/routes/phase.routes');
const aiRoutes = require('./src/routes/ai.routes');
const { notFoundHandler, errorHandler } = require('./src/middlewares/error.middleware');

const app = express();
const PORT = env.PORT;
const SIMULATION_INTERVAL_MS = 10000; // Check active orders every ~10 seconds

// Disable X-Powered-By header
app.disable('x-powered-by');

// Security headers with Helmet
// Relax CSP for Swagger UI (/api/docs) so interactive scripts and styles can load
app.use((req, res, next) => {
  if (req.path.startsWith('/api/docs')) {
    return helmet({
      contentSecurityPolicy: false,
    })(req, res, next);
  }
  return helmet()(req, res, next);
});

// CORS configuration driven by CORS_ORIGINS
const corsOptions = {
  origin: (origin, callback) => {
    // Requests with no Origin header (native mobile apps, curl, server-to-server) are always allowed
    if (!origin) {
      return callback(null, true);
    }

    const currentCors = env.CORS_ORIGINS || '*';
    if (currentCors === '*') {
      return callback(null, true);
    }

    const allowedOrigins = currentCors
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }

    // Origin not allowed: omit Access-Control-Allow-Origin
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

app.use(express.json({ limit: '100kb' }));
app.use(morgan('dev'));

// Static files for photo evidence (CORP set to cross-origin for external frontend consumption)
app.use(
  '/evidence',
  helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }),
  express.static(path.join(__dirname, 'storage/evidence'))
);

// Swagger API Documentation
app.get('/api/docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'AutoClean AI API',
  })
);

const { globalLimiter } = require('./src/middlewares/rateLimit.middleware');

// Apply global rate limiter to all /api routes (skips /api/health and /api/docs)
app.use('/api', globalLimiter);

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/bays', bayRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/orders', serviceOrderRoutes);
app.use('/api/orders', evidenceRoutes);
app.use('/api/phases', phaseRoutes);
app.use('/api', aiRoutes);


// Centralized 404 and error handling middlewares
app.use(notFoundHandler);
app.use(errorHandler);

// Background simulation scheduler: runs every ~10s and advances active orders
const simulationInterval = setInterval(async () => {
  try {
    if (!env.SIMULATION_AUTO_ADVANCE) {
      return;
    }

    const activeOrders = await prisma.serviceOrder.findMany({
      where: {
        faseActual: {
          not: 'LISTO',
        },
        listoParaLavar: true,
      },
    });

    for (const order of activeOrders) {
      await advanceOrderPhase(order);
    }
  } catch (error) {
    console.error('[SIMULATION] error:', error.message || error);
  }
}, SIMULATION_INTERVAL_MS);

// Process-level error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception thrown:', err);
  process.exit(1);
});

const server = app.listen(PORT, () => {
  console.log(`AutoClean AI backend running on http://localhost:${PORT}`);
});

module.exports = { app, server, simulationInterval };
