require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const prisma = require('./src/config/db');
const { advanceOrderPhase } = require('./src/services/simulation.service');
const healthRoutes = require('./src/routes/health.routes');
const vehicleRoutes = require('./src/routes/vehicle.routes');
const bayRoutes = require('./src/routes/bay.routes');
const packageRoutes = require('./src/routes/package.routes');
const serviceOrderRoutes = require('./src/routes/serviceOrder.routes');
const evidenceRoutes = require('./src/routes/evidence.routes');
const { notFoundHandler, errorHandler } = require('./src/middlewares/error.middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const SIMULATION_INTERVAL_MS = 10000; // Check active orders every ~10 seconds

// Middlewares
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Static files for photo evidence
app.use('/evidence', express.static(path.join(__dirname, 'storage/evidence')));

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/bays', bayRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/orders', serviceOrderRoutes);
app.use('/api/orders', evidenceRoutes);

// Centralized 404 and error handling middlewares
app.use(notFoundHandler);
app.use(errorHandler);

// Background simulation scheduler: runs every ~10s and advances active orders
const simulationInterval = setInterval(async () => {
  try {
    const activeOrders = await prisma.serviceOrder.findMany({
      where: {
        faseActual: {
          not: 'LISTO',
        },
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
