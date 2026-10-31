import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';

const ORIGIN = 'http://localhost:5173';

describe('security headers', () => {
  it('sets the helmet headers and hides X-Powered-By', async () => {
    const res = await request(createApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('also sets them on an error answer', async () => {
    const res = await request(createApp()).get('/nothing-here');

    expect(res.status).toBe(404);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('sends no CORS header when no origin is configured', async () => {
    const res = await request(createApp()).get('/health').set('Origin', ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('lets a listed origin read the answer, with credentials for the cookie', async () => {
    const app = createApp({ corsOrigins: [ORIGIN] });
    const res = await request(app).get('/health').set('Origin', ORIGIN);

    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it('does not let an origin that is not listed read the answer', async () => {
    const app = createApp({ corsOrigins: [ORIGIN] });
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('accepts several origins and answers each with its own', async () => {
    const other = 'https://unitrace.example';
    const app = createApp({ corsOrigins: [ORIGIN, other] });

    const first = await request(app).get('/health').set('Origin', ORIGIN);
    const second = await request(app).get('/health').set('Origin', other);

    expect(first.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(second.headers['access-control-allow-origin']).toBe(other);
  });

  it('answers the preflight of a listed origin with 204 and the allowed methods', async () => {
    const app = createApp({ corsOrigins: [ORIGIN] });
    const res = await request(app)
      .options('/api/v1/declarations')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-methods']).toMatch(/PATCH/);
    expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
  });
});
