const { Router } = require('express');
const { getBays, getBaySummary } = require('../controllers/bay.controller');

const router = Router();

router.get('/summary', getBaySummary);
router.get('/', getBays);

module.exports = router;
