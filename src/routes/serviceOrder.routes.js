const { Router } = require('express');
const {
  getServiceOrders,
  createServiceOrder,
  updateServicePhase,
} = require('../controllers/serviceOrder.controller');

const router = Router();

router.get('/', getServiceOrders);
router.post('/', createServiceOrder);
router.patch('/:id/phase', updateServicePhase);

module.exports = router;
