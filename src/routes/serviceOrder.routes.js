const { Router } = require('express');
const {
  getServiceOrders,
  createServiceOrder,
} = require('../controllers/serviceOrder.controller');

const router = Router();

router.get('/', getServiceOrders);
router.post('/', createServiceOrder);

module.exports = router;
