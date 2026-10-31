// Errors thrown on purpose. The error handler only shows the message of an AppError to the
// client, everything else becomes a generic 500.
export class AppError extends Error {
  constructor(message, { statusCode, code, details = [] }) {
    super(message);
    // The name follows the subclass, so logs show ValidationError and not AppError.
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    // Marks an expected error. The error handler relies on instanceof AppError, this flag is only
    // asserted in the unit tests.
    this.isOperational = true;
    // The stack starts at the line that threw, without the constructor frames.
    Error.captureStackTrace(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid input', details = []) {
    super(message, { statusCode: 400, code: 'VALIDATION_ERROR', details });
  }
}

// One message for a wrong, expired or exhausted code, so the answer does not help to guess.
export class InvalidCodeError extends AppError {
  constructor(message = 'Invalid or expired code') {
    super(message, { statusCode: 400, code: 'INVALID_CODE' });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, { statusCode: 401, code: 'UNAUTHENTICATED' });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You are not allowed to do this') {
    super(message, { statusCode: 403, code: 'FORBIDDEN' });
  }
}

// Its own code, distinct from FORBIDDEN, so a client can tell it apart from a suspension.
export class EmailNotVerifiedError extends AppError {
  constructor(message = 'Email address is not verified') {
    super(message, { statusCode: 403, code: 'EMAIL_NOT_VERIFIED' });
  }
}

// Also used instead of a 403 when a user asks for a declaration they should not know exists
// (hidden or deleted ones), so the answer does not reveal it.
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, { statusCode: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details = []) {
    super(message, { statusCode: 409, code: 'CONFLICT', details });
  }
}

export class FileTooLargeError extends AppError {
  constructor(message = 'File is too large') {
    super(message, { statusCode: 413, code: 'FILE_TOO_LARGE' });
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests', { retryAfterSeconds } = {}) {
    super(message, { statusCode: 429, code: 'RATE_LIMITED' });
    // Not part of the body: the error handler turns it into the Retry-After header.
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
