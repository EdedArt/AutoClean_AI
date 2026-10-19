const { Router } = require('express');
const { getBays } = require('../controllers/bay.controller');

const router = Router();

router.get('/', getBays);

module.exports = router;
