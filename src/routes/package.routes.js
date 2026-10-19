const { Router } = require('express');
const { getPackages } = require('../controllers/package.controller');

const router = Router();

router.get('/', getPackages);

module.exports = router;
