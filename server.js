require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const healthRoutes = require('./src/routes/health.routes');
const vehicleRoutes = require('./src/routes/vehicle.routes');
const bayRoutes = require('./src/routes/bay.routes');
const packageRoutes = require('./src/routes/package.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/bays', bayRoutes);
app.use('/api/packages', packageRoutes);

// Centralized error handling middleware
app.use((err, req, res, next) => {
  console.error(err.message || err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
  });
});

app.listen(PORT, () => {
  console.log(`AutoClean AI backend running on http://localhost:${PORT}`);
});
