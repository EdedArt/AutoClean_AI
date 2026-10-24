const { Router } = require('express');
const upload = require('../middlewares/upload.middleware');
const { validate } = require('../middlewares/validate.middleware');
const { evidenceUploadLimiter } = require('../middlewares/rateLimit.middleware');
const { orderIdParam } = require('../validators/common.schema');
const { uploadEvidence: uploadEvidenceSchema } = require('../validators/evidence.schema');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  uploadEvidence,
  getEvidencesByOrder,
} = require('../controllers/evidence.controller');

const router = Router();

router.use(authenticate);

// Middleware to handle multipart upload and format errors
const handleUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      return next(err);
    }
    if (req.files && req.files.length > 0) {
      req.file = req.files[0];
    }
    next();
  });
};

router.post(
  '/:orderId/evidence',
  authorize('OPERARIO'),
  evidenceUploadLimiter,
  validate(orderIdParam, 'params'),
  handleUpload,
  validate(uploadEvidenceSchema, 'body'),
  uploadEvidence
);

router.get('/:orderId/evidence', authorize('OPERARIO', 'CLIENTE'), validate(orderIdParam, 'params'), getEvidencesByOrder);

module.exports = router;
