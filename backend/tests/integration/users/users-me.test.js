import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const URL = '/api/v1/users/me';

describe('GET /api/v1/users/me', () => {
  let ctx;
  let user;
  let token;

  const get = (header) => {
    const req = request(ctx.app).get(URL);
    return header ? req.set('Authorization', header) : req;
  };

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await clearTestDb();
    user = await User.create({
      username: 'sara.k',
      email: 'sara@isamm.uma.tn',
      password: await ctx.passwordHasher.hash('Secret123'),
      isEmailVerified: true,
    });
    token = ctx.tokenService.signAccessToken(user);
  });

  it('returns the connected user with a safe shape', async () => {
    const res = await get(`Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(String(user._id));
    expect(res.body.user.email).toBe('sara@isamm.uma.tn');
    expect(Object.keys(res.body.user).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'isEmailVerified',
      'phone',
      'role',
      'username',
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/i);
  });

  it('works end to end with a token obtained from the login route', async () => {
    const login = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@isamm.uma.tn', password: 'Secret123' });

    const res = await get(`Bearer ${login.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(String(user._id));
  });

  it('answers 401 without an Authorization header', async () => {
    const res = await get();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(['Token abc', 'Bearer', 'abc'])('answers 401 for the header "%s"', async (header) => {
    const res = await get(header);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers 401 for a garbage token', async () => {
    const res = await get('Bearer not.a.token');

    expect(res.status).toBe(401);
  });

  it('answers 401 for an expired token', async () => {
    ctx.advance(15 * 60_000 + 1000);

    const res = await get(`Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers 401 for a token signed with another secret', async () => {
    const forged = jwt.sign({ sub: String(user._id) }, 'x'.repeat(32), {
      expiresIn: '15m',
      issuer: 'unitrace',
    });

    const res = await get(`Bearer ${forged}`);

    expect(res.status).toBe(401);
  });

  it('answers 401 for an unsigned token (alg none)', async () => {
    const unsigned = jwt.sign({ sub: String(user._id) }, '', {
      algorithm: 'none',
      issuer: 'unitrace',
    });

    const res = await get(`Bearer ${unsigned}`);

    expect(res.status).toBe(401);
  });

  it('cuts off a suspended user at once, without waiting for the token to expire', async () => {
    await User.updateOne({ _id: user._id }, { isActive: false });

    const res = await get(`Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('answers 401 once the account is deleted', async () => {
    await User.updateOne({ _id: user._id }, { deletedAt: new Date() });

    const res = await get(`Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('answers 401 when the user no longer exists', async () => {
    await User.deleteOne({ _id: user._id });

    const res = await get(`Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});
