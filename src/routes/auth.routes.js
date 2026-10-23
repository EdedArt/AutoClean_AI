const express = require('express');
const { register, login, getMe } = require('../controllers/auth.controller');
const { validate } = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const { registerSchema, loginSchema } = require('../validators/auth.schema');

const router = express.Router();

router.post('/register', validate(registerSchema, 'body'), register);
router.post('/login', validate(loginSchema, 'body'), login);
router.get('/me', authenticate, getMe);

module.exports = router;
