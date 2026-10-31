import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createErrorHandler } from '../../../src/middlewares/common/error-handler.js';
import { notFoundHandler } from '../../../src/middlewares/common/not-found.js';
import {
  ConflictError,
  RateLimitedError,
  ValidationError,
} from '../../../src/exceptions/app-error.js';

function buildApp(logger) {
  const app = express();
  app.use(express.json());

  app.get('/conflict', () => {
    throw new ConflictError('Duplicate account', [
      { field: 'email', message: 'Email is already used' },
    ]);
  });
  app.get('/validation', () => {
    throw new ValidationError();
  });
  app.get('/rate-limited', () => {
    throw new RateLimitedError('Wait before resending', { retryAfterSeconds: 87 });
  });
  app.get('/boom', () => {
    throw new Error('database password is hunter2');
  });
  app.post('/echo', (req, res) => res.json(req.body));

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger }));
  return app;
}

describe('error handler', () => {
  const logger = { error: vi.fn() };
  const app = buildApp(logger);

  it('formats an AppError with its details', async () => {
    const res = await request(app).get('/conflict');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Duplicate account',
        details: [{ field: 'email', message: 'Email is already used' }],
      },
    });
  });

  it('uses an empty details array by default', async () => {
    const res = await request(app).get('/validation');

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([]);
  });

  it('sets Retry-After on a rate limit error', async () => {
    const res = await request(app).get('/rate-limited');

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('87');
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('hides unexpected errors behind a generic 500 and logs them', async () => {
    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: [] },
    });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('returns the shared format for an unknown route', async () => {
    const res = await request(app).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for malformed JSON', async () => {
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
