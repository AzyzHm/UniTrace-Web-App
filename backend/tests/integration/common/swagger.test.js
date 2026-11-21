import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { swaggerSpec } from '../../../src/docs/swagger.js';
import { buildTestApp } from '../../helpers/build-test-app.js';

const SAMPLE_ID = '665f2a7b9b1d8a0012a4c801';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// Every documented operation as { method, url }, with path parameters filled in.
function documentedOperations() {
  return Object.entries(swaggerSpec.paths).flatMap(([route, item]) =>
    METHODS.filter((method) => item[method]).map((method) => ({
      method,
      url: route.replace('{id}', SAMPLE_ID),
    })),
  );
}

describe('API documentation', () => {
  it('builds an OpenAPI 3 document with the documented areas', () => {
    expect(swaggerSpec.openapi).toBe('3.0.3');
    expect(Object.keys(swaggerSpec.paths)).toEqual(
      expect.arrayContaining([
        '/health',
        '/api/v1/auth/login',
        '/api/v1/users/me',
        '/api/v1/declarations',
        '/api/v1/declarations/{id}/status',
      ]),
    );
    expect(swaggerSpec.components.securitySchemes.bearerAuth).toBeDefined();
  });

  it('serves the raw document as JSON', async () => {
    const res = await request(createApp()).get('/api-docs.json');

    expect(res.status).toBe(200);
    expect(res.body.info.title).toBe('UniTrace API');
  });

  it('serves the Swagger UI page', async () => {
    const res = await request(createApp()).get('/api-docs/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('swagger-ui');
  });

  it('relaxes only upgrade-insecure-requests on the docs page', async () => {
    const app = createApp();
    const docs = await request(app).get('/api-docs/');
    const health = await request(app).get('/health');

    expect(docs.headers['content-security-policy']).toBeDefined();
    expect(docs.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    expect(health.headers['content-security-policy']).toContain('upgrade-insecure-requests');
  });

  // Guards against documentation that drifts from the code: a documented route that no longer
  // exists answers "Route ... not found". No token is sent, so protected routes stop at 401
  // before touching the database.
  it('documents only routes that really exist', async () => {
    const { app } = buildTestApp();

    for (const { method, url } of documentedOperations()) {
      const res = await request(app)[method](url);
      const message = res.body?.error?.message ?? '';

      expect(message, `${method.toUpperCase()} ${url}`).not.toMatch(/^Route .* not found$/);
    }
  });
});
