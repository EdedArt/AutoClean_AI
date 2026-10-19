const { Router } = require('express');
const {
  getVehicles,
  getVehicleById,
  createVehicle,
} = require('../controllers/vehicle.controller');

const router = Router();

router.get('/', getVehicles);
router.get('/:id', getVehicleById);
router.post('/', createVehicle);

module.exports = router;
