require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const healthRoutes = require('./src/routes/health.routes');
const vehicleRoutes = require('./src/routes/vehicle.routes');
const bayRoutes = require('./src/routes/bay.routes');
const packageRoutes = require('./src/routes/package.routes');
const serviceOrderRoutes = require('./src/routes/serviceOrder.routes');
const evidenceRoutes = require('./src/routes/evidence.routes');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Centralized error handling middleware
app.use((err, req, res, next) => {
  console.error(err.message || err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

app.listen(PORT, () => {
  console.log(`AutoClean AI backend running on http://localhost:${PORT}`);
});
