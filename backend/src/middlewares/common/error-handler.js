import { AppError, ValidationError } from '../../exceptions/app-error.js';

function fromFrameworkError(err) {
  if (err.type === 'entity.parse.failed') {
    return new ValidationError('Malformed JSON body');
  }
  if (err.type === 'entity.too.large') {
    return new ValidationError('Request body is too large');
  }
  return null;
}

export function createErrorHandler({ logger }) {
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) {
      return next(err);
    }

    const known = err instanceof AppError ? err : fromFrameworkError(err);

    if (known) {
      if (known.retryAfterSeconds !== undefined) {
        res.set('Retry-After', String(known.retryAfterSeconds));
      }
      return res.status(known.statusCode).json({
        error: {
          code: known.code,
          message: known.message,
          details: known.details,
        },
      });
    }

    logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');

    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: [],
      },
    });
  };
}
