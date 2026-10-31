import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RefreshToken } from '../../../src/models/auth/refresh-token.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';
const ME = '/api/v1/users/me';
const COOKIE = 'refreshToken';

const cookieHeaderOf = (res) => res.headers['set-cookie']?.find((c) => c.startsWith(`${COOKIE}=`));
const tokenOf = (res) =>
  cookieHeaderOf(res)
    .split(';')[0]
    .slice(COOKIE.length + 1);

describe('POST /api/v1/auth/logout', () => {
  let ctx;

  const withCookie = (req, token) => (token ? req.set('Cookie', `${COOKIE}=${token}`) : req);

  async function login() {
    const res = await request(ctx.app)
      .post(LOGIN)
      .send({ email: 'sara@isamm.uma.tn', password: 'Secret123' });
    return { accessToken: res.body.accessToken, refreshToken: tokenOf(res) };
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
    await User.create({
      username: 'sara.k',
      email: 'sara@isamm.uma.tn',
      password: await ctx.passwordHasher.hash('Secret123'),
      isEmailVerified: true,
    });
  });

  it('answers 204, removes the cookie and deletes the token from the database', async () => {
    const { refreshToken } = await login();

    const res = await withCookie(request(ctx.app).post(LOGOUT), refreshToken);

    expect(res.status).toBe(204);
    expect(cookieHeaderOf(res)).toMatch(/^refreshToken=;/);
    expect(cookieHeaderOf(res)).toContain('Path=/api/v1/auth');
    expect(await RefreshToken.countDocuments()).toBe(0);
  });

  it('makes the token useless for refreshing', async () => {
    const { refreshToken } = await login();
    await withCookie(request(ctx.app).post(LOGOUT), refreshToken);

    const res = await withCookie(request(ctx.app).post(REFRESH), refreshToken);

    expect(res.status).toBe(401);
  });

  it('ends only this device, the other sessions of the user keep working', async () => {
    const phone = await login();
    const laptop = await login();

    await withCookie(request(ctx.app).post(LOGOUT), phone.refreshToken);
    const res = await withCookie(request(ctx.app).post(REFRESH), laptop.refreshToken);

    expect(res.status).toBe(200);
  });

  it('answers 204 even with no cookie', async () => {
    const res = await request(ctx.app).post(LOGOUT);

    expect(res.status).toBe(204);
  });

  it('answers 204 when called twice', async () => {
    const { refreshToken } = await login();
    await withCookie(request(ctx.app).post(LOGOUT), refreshToken);

    const res = await withCookie(request(ctx.app).post(LOGOUT), refreshToken);

    expect(res.status).toBe(204);
  });

  it('needs no access token, so it works after the access token has expired', async () => {
    const { refreshToken } = await login();

    const res = await withCookie(request(ctx.app).post(LOGOUT), refreshToken);

    expect(res.status).toBe(204);
    expect(await RefreshToken.countDocuments()).toBe(0);
  });

  it('does not cancel an access token already issued, which stays valid until it expires', async () => {
    const { accessToken, refreshToken } = await login();
    await withCookie(request(ctx.app).post(LOGOUT), refreshToken);

    const res = await request(ctx.app).get(ME).set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
  });
});
