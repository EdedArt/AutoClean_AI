const fs = require('fs');
const AppError = require('../utils/AppError');

/**
 * Removes any temporary files uploaded via Multer if validation fails
 * @param {import('express').Request} req
 */
const cleanupMulterFiles = (req) => {
  if (req.file && req.file.path && fs.existsSync(req.file.path)) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (_) {}
  }

  if (Array.isArray(req.files)) {
    for (const file of req.files) {
      if (file && file.path && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (_) {}
      }
    }
  } else if (req.files && typeof req.files === 'object') {
    for (const key of Object.keys(req.files)) {
      const fileArray = req.files[key];
      if (Array.isArray(fileArray)) {
        for (const file of fileArray) {
          if (file && file.path && fs.existsSync(file.path)) {
            try {
              fs.unlinkSync(file.path);
            } catch (_) {}
          }
        }
      }
    }
  }
};

/**
 * Middleware factory for Zod validation
 * @param {import('zod').ZodSchema} schema
 * @param {'body'|'params'|'query'} [source='body']
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      cleanupMulterFiles(req);

      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message,
      }));

      return next(new AppError('Validation failed', 400, 'VALIDATION_ERROR', details));
    }

    req[source] = result.data;
    next();
  };
};

module.exports = {
  validate,
  cleanupMulterFiles,
};
