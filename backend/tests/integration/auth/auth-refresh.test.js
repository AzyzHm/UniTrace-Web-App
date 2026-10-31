import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REFRESH_TOKEN_TTL_MS } from '../../../src/constants/auth/refresh-token.js';
import { RefreshToken } from '../../../src/models/auth/refresh-token.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const ME = '/api/v1/users/me';
const COOKIE = 'refreshToken';
const PASSWORD = 'Secret123';

const cookieHeaderOf = (res) => res.headers['set-cookie']?.find((c) => c.startsWith(`${COOKIE}=`));
const tokenOf = (res) =>
  cookieHeaderOf(res)
    .split(';')[0]
    .slice(COOKIE.length + 1);

describe('POST /api/v1/auth/refresh', () => {
  let ctx;
  let user;

  const refresh = (token) => {
    const req = request(ctx.app).post(REFRESH);
    return token ? req.set('Cookie', `${COOKIE}=${token}`) : req;
  };

  async function createUser(overrides = {}) {
    return User.create({
      username: 'sara.k',
      email: 'sara@isamm.uma.tn',
      password: await ctx.passwordHasher.hash(PASSWORD),
      isEmailVerified: true,
      ...overrides,
    });
  }

  async function login(email = 'sara@isamm.uma.tn') {
    const res = await request(ctx.app).post(LOGIN).send({ email, password: PASSWORD });
    return { res, accessToken: res.body.accessToken, refreshToken: tokenOf(res) };
  }

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    await RefreshToken.init();
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await clearTestDb();
    user = await createUser();
  });

  describe('the cookie set by login', () => {
    it('is httpOnly, strict, scoped to the auth routes and lasts 30 days', async () => {
      const { res } = await login();
      const header = cookieHeaderOf(res);

      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Strict');
      expect(header).toContain('Path=/api/v1/auth');
      expect(header).toContain(`Max-Age=${REFRESH_TOKEN_TTL_MS / 1000}`);
      expect(header).not.toContain('Secure');
    });

    it('never appears in the response body', async () => {
      const { res, refreshToken } = await login();

      expect(JSON.stringify(res.body)).not.toContain(refreshToken);
      expect(res.body.refreshToken).toBeUndefined();
    });

    it('is stored only as a hash', async () => {
      const { refreshToken } = await login();

      const stored = await RefreshToken.findOne();

      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.tokenHash).not.toContain(refreshToken);
      expect(String(stored.user)).toBe(String(user._id));
    });
  });

  it('gives a new access token that works, and a new cookie', async () => {
    const first = await login();

    const res = await refresh(first.refreshToken);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.user.id).toBe(String(user._id));
    expect(tokenOf(res)).not.toBe(first.refreshToken);
    const me = await request(ctx.app)
      .get(ME)
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('never puts the new refresh token in the body', async () => {
    const first = await login();

    const res = await refresh(first.refreshToken);

    expect(JSON.stringify(res.body)).not.toContain(tokenOf(res));
    expect(res.body.refreshToken).toBeUndefined();
  });

  it('keeps the old token as used and adds the new one', async () => {
    const first = await login();

    await refresh(first.refreshToken);

    expect(await RefreshToken.countDocuments()).toBe(2);
    expect(await RefreshToken.countDocuments({ usedAt: { $ne: null } })).toBe(1);
  });

  it('can chain: the new token refreshes again', async () => {
    const first = await login();
    const second = await refresh(first.refreshToken);

    const third = await refresh(tokenOf(second));

    expect(third.status).toBe(200);
  });

  it('answers 401 with no cookie', async () => {
    const res = await refresh();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers 401 for an unknown token, and removes the cookie', async () => {
    const res = await refresh('not-a-real-token');

    expect(res.status).toBe(401);
    expect(cookieHeaderOf(res)).toMatch(/^refreshToken=;/);
    expect(cookieHeaderOf(res)).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('treats a replayed token as theft: refused, and every session of that user ends', async () => {
    const first = await login();
    const rotated = await refresh(first.refreshToken);
    const newToken = tokenOf(rotated);

    const replay = await refresh(first.refreshToken);
    const afterwards = await refresh(newToken);

    expect(replay.status).toBe(401);
    expect(afterwards.status).toBe(401);
    expect(await RefreshToken.countDocuments()).toBe(0);
  });

  it('leaves the sessions of other users alone when one token is replayed', async () => {
    await createUser({ username: 'omar.b', email: 'omar@isamm.uma.tn' });
    const sara = await login('sara@isamm.uma.tn');
    const omar = await login('omar@isamm.uma.tn');
    await refresh(sara.refreshToken);

    await refresh(sara.refreshToken);
    const res = await refresh(omar.refreshToken);

    expect(res.status).toBe(200);
  });

  it('lets exactly one of two simultaneous refreshes with the same token win', async () => {
    const first = await login();

    const [a, b] = await Promise.all([refresh(first.refreshToken), refresh(first.refreshToken)]);

    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it('answers 403 for a suspended user and keeps the token, so reinstating works', async () => {
    const first = await login();
    await User.updateOne({ _id: user._id }, { isActive: false });

    const blocked = await refresh(first.refreshToken);
    await User.updateOne({ _id: user._id }, { isActive: true });
    const reinstated = await refresh(first.refreshToken);

    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('FORBIDDEN');
    expect(cookieHeaderOf(blocked)).toBeUndefined();
    expect(reinstated.status).toBe(200);
  });

  it('answers 401 once the account is deleted', async () => {
    const first = await login();
    await User.updateOne({ _id: user._id }, { deletedAt: new Date() });

    const res = await refresh(first.refreshToken);

    expect(res.status).toBe(401);
  });

  it('answers 401 for an expired token', async () => {
    const first = await login();
    ctx.advance(REFRESH_TOKEN_TTL_MS + 1000);

    const res = await refresh(first.refreshToken);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
