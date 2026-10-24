const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const { placaParam } = require('../validators/common.schema');
const { plateLookupLimiter } = require('../middlewares/rateLimit.middleware');
const { getPlateStatus } = require('../controllers/plate.controller');

const router = Router();

router.use(authenticate);

router.get(
  '/:placa/status',
  plateLookupLimiter,
  validate(placaParam, 'params'),
  getPlateStatus
);

module.exports = router;
