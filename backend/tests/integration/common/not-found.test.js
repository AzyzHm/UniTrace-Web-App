import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';

describe('app error wiring', () => {
  const app = createApp();

  it('answers unknown routes with the shared error format', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route GET /api/v1/does-not-exist not found',
        details: [],
      },
    });
  });

  it('answers a body over 10kb with a validation error', async () => {
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(11 * 1024) }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
