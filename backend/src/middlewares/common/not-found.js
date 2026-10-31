import { NotFoundError } from '../../exceptions/app-error.js';

export function notFoundHandler(req, res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
}
