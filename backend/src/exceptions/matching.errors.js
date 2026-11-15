// The matching module throws the project's own errors, so the error handler (which relies on
// `instanceof AppError`) shows their message and status instead of a generic 500.
// The classes live in exceptions/app-error.js.
export { ValidationError, ForbiddenError, NotFoundError, ConflictError } from './app-error.js';
