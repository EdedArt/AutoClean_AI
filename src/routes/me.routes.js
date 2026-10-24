const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const { placaParam } = require('../validators/common.schema');
const { getMyPlates, deleteMyPlate } = require('../controllers/me.controller');

const router = Router();

router.use(authenticate);
router.use(authorize('CLIENTE'));

router.get('/plates', getMyPlates);
router.delete('/plates/:placa', validate(placaParam, 'params'), deleteMyPlate);

module.exports = router;
