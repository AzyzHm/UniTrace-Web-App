import express from 'express';
import Joi from 'joi';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createErrorHandler } from '../../../src/middlewares/common/error-handler.js';
import { validate } from '../../../src/middlewares/common/validate.js';

const silentLogger = { error() {} };

function buildApp() {
  const app = express();
  app.use(express.json());

  const bodySchema = Joi.object({
    email: Joi.string().email().lowercase().trim().required(),
    age: Joi.number().integer().min(18).required(),
  });
  const paramsSchema = Joi.object({ id: Joi.string().hex().length(24).required() });
  const querySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(10),
  });

  app.post('/body', validate(bodySchema), (req, res) => res.json(req.body));
  app.get('/params/:id', validate(paramsSchema, 'params'), (req, res) => res.json(req.params));
  app.get('/query', validate(querySchema, 'query'), (req, res) => res.json(req.query));

  app.use(createErrorHandler({ logger: silentLogger }));
  return app;
}

describe('validate middleware', () => {
  const app = buildApp();

  it('passes valid input and replaces it with the cleaned value', async () => {
    const res = await request(app).post('/body').send({ email: '  Sara@Univ.DZ ', age: '20' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'sara@univ.dz', age: 20 });
  });

  it('rejects unknown fields, such as a role', async () => {
    const res = await request(app)
      .post('/body')
      .send({ email: 'sara@univ.dz', age: 20, role: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'role', message: 'role is not allowed' }]);
  });

  it('returns every error at once', async () => {
    const res = await request(app).post('/body').send({ email: 'nope', age: 3 });

    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d) => d.field).sort();
    expect(fields).toEqual(['age', 'email']);
  });

  it('treats a missing body as an empty object', async () => {
    const res = await request(app).post('/body');

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['age', 'email']);
  });

  it('validates params', async () => {
    const ok = await request(app).get('/params/507f1f77bcf86cd799439011');
    const bad = await request(app).get('/params/not-an-id');

    expect(ok.status).toBe(200);
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].field).toBe('id');
  });

  it('converts and defaults query values', async () => {
    const res = await request(app).get('/query?page=2');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ page: 2, limit: 10 });
  });

  it('rejects an out of range query value', async () => {
    const res = await request(app).get('/query?limit=500');

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('limit');
  });

  it('throws at definition time for an invalid source', () => {
    expect(() => validate(Joi.object(), 'headers')).toThrow(/source must be one of/);
  });
});
