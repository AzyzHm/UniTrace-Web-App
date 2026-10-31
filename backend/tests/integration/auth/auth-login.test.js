import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const URL = '/api/v1/auth/login';
const EMAIL = 'sara@isamm.uma.tn';
const PASSWORD = 'Secret123';

describe('POST /api/v1/auth/login', () => {
  let ctx;

  async function createUser(overrides = {}) {
    return User.create({
      username: 'sara.k',
      email: EMAIL,
      password: await ctx.passwordHasher.hash(PASSWORD),
      isEmailVerified: true,
      ...overrides,
    });
  }

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  it('logs in and answers 200 with a token and a safe user shape', async () => {
    const user = await createUser();

    const res = await request(ctx.app).post(URL).send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(Object.keys(res.body.user).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'isEmailVerified',
      'phone',
      'role',
      'username',
    ]);
    expect(res.body.user.id).toBe(String(user._id));
  });

  it('never exposes the password, plain or hashed', async () => {
    await createUser();

    const res = await request(ctx.app).post(URL).send({ email: EMAIL, password: PASSWORD });

    expect(JSON.stringify(res.body)).not.toMatch(/password|Secret123|\$2[aby]\$/i);
  });

  it('forbids caching of the response that carries the token', async () => {
    await createUser();

    const res = await request(ctx.app).post(URL).send({ email: EMAIL, password: PASSWORD });

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('signs a token with only the user id, no role', async () => {
    const user = await createUser();

    const res = await request(ctx.app).post(URL).send({ email: EMAIL, password: PASSWORD });
    const payload = jwt.decode(res.body.accessToken);

    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'iss', 'sub']);
    expect(payload.sub).toBe(String(user._id));
  });

  it('accepts the email in any case', async () => {
    await createUser();

    const res = await request(ctx.app)
      .post(URL)
      .send({ email: 'Sara@ISAMM.uma.tn', password: PASSWORD });

    expect(res.status).toBe(200);
  });

  it('answers 401 for a wrong password, with a generic message', async () => {
    await createUser();

    const res = await request(ctx.app).post(URL).send({ email: EMAIL, password: 'Wrong123' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message).toBe('Invalid email or password');
    expect(res.body.accessToken).toBeUndefined();
  });

  it('answers an unknown email exactly like a wrong password', async () => {
    await createUser();
    const wrong = await request(ctx.app).post(URL).send({ email: EMAIL, password: 'Wrong123' });

    const unknown = await request(ctx.app)
      .post(URL)
      .send({ email: 'nobody@isamm.uma.tn', password: PASSWORD });

    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('answers 403 EMAIL_NOT_VERIFIED for an unverified account with the right password', async () => {
    await createUser({ isEmailVerified: false });

    const res = await request(ctx.app).post(URL).send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(res.body.accessToken).toBeUndefined();
  });

  it('does not reveal an unverified account to someone with the wrong password', async () => {
    await createUser({ isEmailVerified: false });

    const res = await request(ctx.app).post(URL).send({ email: EMAIL, password: 'Wrong123' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers 403 FORBIDDEN for a suspended account, and gives no token', async () => {
    await createUser({ isActive: false });

    const res = await request(ctx.app).post(URL).send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.accessToken).toBeUndefined();
  });

  it('rejects a missing password before touching the database', async () => {
    const res = await request(ctx.app).post(URL).send({ email: EMAIL });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('password');
  });

  it('rejects unknown fields', async () => {
    const res = await request(ctx.app)
      .post(URL)
      .send({ email: EMAIL, password: PASSWORD, role: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'role', message: 'role is not allowed' }]);
  });

  it('refuses a body that tries a NoSQL operator instead of a string', async () => {
    await createUser();

    const res = await request(ctx.app)
      .post(URL)
      .send({ email: { $gt: '' }, password: PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
