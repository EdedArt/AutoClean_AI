const { Router } = require('express');
const {
  getServiceOrders,
  createServiceOrder,
  updateServicePhase,
  trackOrderByPlaca,
} = require('../controllers/serviceOrder.controller');

const router = Router();

router.get('/', getServiceOrders);
router.get('/track/:placa', trackOrderByPlaca);
router.post('/', createServiceOrder);
router.patch('/:id/phase', updateServicePhase);

module.exports = router;
