import { AppError, ValidationError } from '../../exceptions/app-error.js';

// Errors raised by express.json() are not AppErrors. They are mapped here to keep the shared
// 400 format instead of falling into the generic 500.
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
    // A response is already partly sent, so a JSON error can no longer be written. Passing the
    // error on lets Express close the connection.
    if (res.headersSent) {
      return next(err);
    }

    const known = err instanceof AppError ? err : fromFrameworkError(err);

    if (known) {
      // The wait time of a rate limit goes in the standard header, not in the error body.
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

    // Anything else is a bug or an infrastructure failure: log it fully, but never send its
    // message or stack to the client.
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
