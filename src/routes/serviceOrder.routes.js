const { Router } = require('express');
const { validate } = require('../middlewares/validate.middleware');
const { idParam, placaParam } = require('../validators/common.schema');
const {
  createOrder: createOrderSchema,
  updatePhase: updatePhaseSchema,
} = require('../validators/serviceOrder.schema');
const { orderQuery } = require('../validators/query.schema');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
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

router.use(authenticate);

router.get('/', authorize('OPERARIO', 'CLIENTE'), validate(orderQuery, 'query'), getServiceOrders);
router.get('/track/:placa', authorize('OPERARIO', 'CLIENTE'), validate(placaParam, 'params'), trackOrderByPlaca);
router.get('/:id/prediction', authorize('OPERARIO', 'CLIENTE'), validate(idParam, 'params'), getOrderPrediction);
router.post('/', authorize('OPERARIO'), validate(createOrderSchema, 'body'), createServiceOrder);
router.patch(
  '/:id/phase',
  authorize('OPERARIO'),
  validate(idParam, 'params'),
  validate(updatePhaseSchema, 'body'),
  updateServicePhase
);

// Demo control routes
router.post('/:id/simulate/advance', authorize('OPERARIO'), validate(idParam, 'params'), simulateAdvanceOrder);
router.post('/:id/simulate/reset', authorize('OPERARIO'), validate(idParam, 'params'), simulateResetOrder);
router.post('/:id/simulate/complete', authorize('OPERARIO'), validate(idParam, 'params'), simulateCompleteOrder);

module.exports = router;
