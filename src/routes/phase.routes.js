const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { getPhases } = require('../controllers/phase.controller');

const router = Router();

router.use(authenticate);

router.get('/', authorize('OPERARIO', 'CLIENTE'), getPhases);

module.exports = router;
