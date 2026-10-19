const { Router } = require('express');
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

router.get('/', getServiceOrders);
router.get('/track/:placa', trackOrderByPlaca);
router.get('/:id/prediction', getOrderPrediction);
router.post('/', createServiceOrder);
router.patch('/:id/phase', updateServicePhase);

// Demo control routes
router.post('/:id/simulate/advance', simulateAdvanceOrder);
router.post('/:id/simulate/reset', simulateResetOrder);
router.post('/:id/simulate/complete', simulateCompleteOrder);

module.exports = router;
