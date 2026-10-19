const { Router } = require('express');
const {
  getServiceOrders,
  createServiceOrder,
  updateServicePhase,
  trackOrderByPlaca,
  simulateAdvanceOrder,
  simulateResetOrder,
} = require('../controllers/serviceOrder.controller');

const router = Router();

router.get('/', getServiceOrders);
router.get('/track/:placa', trackOrderByPlaca);
router.post('/', createServiceOrder);
router.patch('/:id/phase', updateServicePhase);

// Demo control routes
router.post('/:id/simulate/advance', simulateAdvanceOrder);
router.post('/:id/simulate/reset', simulateResetOrder);

module.exports = router;
