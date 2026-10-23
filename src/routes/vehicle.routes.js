const { Router } = require('express');
const { validate } = require('../middlewares/validate.middleware');
const { idParam } = require('../validators/common.schema');
const { createVehicle: createVehicleSchema } = require('../validators/vehicle.schema');
const { vehicleQuery } = require('../validators/query.schema');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  getVehicles,
  getVehicleById,
  createVehicle,
} = require('../controllers/vehicle.controller');

const router = Router();

router.use(authenticate);

router.get('/', authorize('OPERARIO', 'CLIENTE'), validate(vehicleQuery, 'query'), getVehicles);
router.get('/:id', authorize('OPERARIO', 'CLIENTE'), validate(idParam, 'params'), getVehicleById);
router.post('/', authorize('OPERARIO'), validate(createVehicleSchema, 'body'), createVehicle);

module.exports = router;
