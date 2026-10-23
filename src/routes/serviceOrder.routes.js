const { Router } = require('express');
const { validate } = require('../middlewares/validate.middleware');
const { idParam, placaParam } = require('../validators/common.schema');
const {
  createOrder: createOrderSchema,
  updatePhase: updatePhaseSchema,
} = require('../validators/serviceOrder.schema');
const { orderQuery } = require('../validators/query.schema');
const {
  getServiceOrders,
  createServiceOrder,
  updateServicePhase,
  trackOrderByPlaca,
  getOrderPrediction,
  simulateAdvanceOrder,
  simulateResetOrder,
  simulateCompleteOrder,
} = require('../controllers/serviceOrder.controller');

const router = Router();

router.get('/', validate(orderQuery, 'query'), getServiceOrders);
router.get('/track/:placa', validate(placaParam, 'params'), trackOrderByPlaca);
router.get('/:id/prediction', validate(idParam, 'params'), getOrderPrediction);
router.post('/', validate(createOrderSchema, 'body'), createServiceOrder);
router.patch(
  '/:id/phase',
  validate(idParam, 'params'),
  validate(updatePhaseSchema, 'body'),
  updateServicePhase
);

// Demo control routes
router.post('/:id/simulate/advance', validate(idParam, 'params'), simulateAdvanceOrder);
router.post('/:id/simulate/reset', validate(idParam, 'params'), simulateResetOrder);
router.post('/:id/simulate/complete', validate(idParam, 'params'), simulateCompleteOrder);

module.exports = router;
