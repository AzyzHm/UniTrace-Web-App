import { NotFoundError } from '../../exceptions/app-error.js';

// Registered after every route, so a request that reaches it matched nothing. It goes through
// the error handler to get the same JSON format as every other error.
export function notFoundHandler(req, res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
}
import { NotFoundError } from '../../exceptions/app-error.js';

// Registered after every route, so a request that reaches it matched nothing. It goes through
// the error handler to get the same JSON format as every other error.
export function notFoundHandler(req, res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
}
