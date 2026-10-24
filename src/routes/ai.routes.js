const { Router } = require('express');
const upload = require('../middlewares/upload.middleware');
const { validate } = require('../middlewares/validate.middleware');
const { aiAnalysisLimiter } = require('../middlewares/rateLimit.middleware');
const { idParam } = require('../validators/common.schema');
const { analyzeBodySchema, analysesQuerySchema } = require('../validators/ai.schema');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  analyzeOrderImage,
  getAiStatus,
  getOrderAnalyses,
} = require('../controllers/ai.controller');

const router = Router();

// All AI endpoints require authenticated OPERARIO role
router.use(['/ai', '/orders'], authenticate, authorize('OPERARIO'));

const handleUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      return next(err);
    }
    if (req.files && req.files.length > 0) {
      req.file = req.files.find((f) => f.fieldname === 'image') || req.files[0];
    }
    next();
  });
};

// AI Status probe
router.get('/ai/status', getAiStatus);

// Order AI camera frame analysis
router.post(
  '/orders/:id/analyze',
  aiAnalysisLimiter,
  validate(idParam, 'params'),
  handleUpload,
  validate(analyzeBodySchema, 'body'),
  analyzeOrderImage
);

// Order AI analysis history
router.get(
  '/orders/:id/analyses',
  validate(idParam, 'params'),
  validate(analysesQuerySchema, 'query'),
  getOrderAnalyses
);

module.exports = router;
