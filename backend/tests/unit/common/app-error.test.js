import { describe, expect, it } from 'vitest';
import {
  AppError,
  ValidationError,
  InvalidCodeError,
  UnauthenticatedError,
  ForbiddenError,
  EmailNotVerifiedError,
  NotFoundError,
  ConflictError,
  FileTooLargeError,
  RateLimitedError,
} from '../../../src/exceptions/app-error.js';

describe('AppError hierarchy', () => {
  it.each([
    [ValidationError, 400, 'VALIDATION_ERROR'],
    [InvalidCodeError, 400, 'INVALID_CODE'],
    [UnauthenticatedError, 401, 'UNAUTHENTICATED'],
    [ForbiddenError, 403, 'FORBIDDEN'],
    [EmailNotVerifiedError, 403, 'EMAIL_NOT_VERIFIED'],
    [NotFoundError, 404, 'NOT_FOUND'],
    [ConflictError, 409, 'CONFLICT'],
    [FileTooLargeError, 413, 'FILE_TOO_LARGE'],
    [RateLimitedError, 429, 'RATE_LIMITED'],
  ])('%o maps to %i and %s', (ErrorClass, statusCode, code) => {
    const error = new ErrorClass();

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(statusCode);
    expect(error.code).toBe(code);
    expect(error.isOperational).toBe(true);
    expect(error.details).toEqual([]);
    expect(error.message).toBeTruthy();
  });

  it('keeps a custom message and details', () => {
    const details = [{ field: 'email', message: 'Email is already used' }];
    const error = new ConflictError('Duplicate account', details);

    expect(error.message).toBe('Duplicate account');
    expect(error.details).toEqual(details);
  });

  it('uses the subclass name', () => {
    expect(new NotFoundError().name).toBe('NotFoundError');
  });

  it('carries retryAfterSeconds on a rate limit error', () => {
    const error = new RateLimitedError('Wait before resending', { retryAfterSeconds: 87 });

    expect(error.retryAfterSeconds).toBe(87);
  });
});
