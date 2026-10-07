const { Router } = require('express');
const upload = require('../middlewares/upload.middleware');
const {
  uploadEvidence,
  getEvidencesByOrder,
} = require('../controllers/evidence.controller');

const router = Router();

// Middleware to handle multipart upload and format errors
const handleUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (req.files && req.files.length > 0) {
      req.file = req.files[0];
    }
    next();
  });
};

router.post('/:orderId/evidence', handleUpload, uploadEvidence);
router.get('/:orderId/evidence', getEvidencesByOrder);

module.exports = router;
