const { Router } = require('express');
const { getBays, getBaySummary } = require('../controllers/bay.controller');
const { authenticate, authorize } = require('../middlewares/auth.middleware');

const router = Router();

router.use(authenticate);

router.get('/summary', authorize('OPERARIO'), getBaySummary);
router.get('/', authorize('OPERARIO', 'CLIENTE'), getBays);

module.exports = router;
