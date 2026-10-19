const { Router } = require('express');
const { validate } = require('../middlewares/validate.middleware');
const { idParam } = require('../validators/common.schema');
const { createVehicle: createVehicleSchema } = require('../validators/vehicle.schema');
const {
  getVehicles,
  getVehicleById,
  createVehicle,
} = require('../controllers/vehicle.controller');

const router = Router();

router.get('/', getVehicles);
router.get('/:id', validate(idParam, 'params'), getVehicleById);
router.post('/', validate(createVehicleSchema, 'body'), createVehicle);

module.exports = router;
