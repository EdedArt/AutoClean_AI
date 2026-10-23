const { Router } = require('express');
const { getPackages } = require('../controllers/package.controller');
const { authenticate, authorize } = require('../middlewares/auth.middleware');

const router = Router();

router.use(authenticate);

router.get('/', authorize('OPERARIO', 'CLIENTE'), getPackages);

module.exports = router;
