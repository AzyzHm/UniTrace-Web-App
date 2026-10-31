import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RefreshToken } from '../../../src/models/auth/refresh-token.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const URL = '/api/v1/users/me/password';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const EMAIL = 'sara@isamm.uma.tn';
const OLD_PASSWORD = 'Secret123';
const NEW_PASSWORD = 'Brandnew456';
const COOKIE = 'refreshToken';

const cookieHeaderOf = (res) => res.headers['set-cookie']?.find((c) => c.startsWith(`${COOKIE}=`));
const tokenOf = (res) =>
  cookieHeaderOf(res)
    .split(';')[0]
    .slice(COOKIE.length + 1);

describe('PATCH /api/v1/users/me/password', () => {
  let ctx;
  let user;
  let token;

  const change = (overrides = {}, header = `Bearer ${token}`) => {
    const req = request(ctx.app)
      .patch(URL)
      .send({
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        ...overrides,
      });
    return header ? req.set('Authorization', header) : req;
  };
  const login = (password) => request(ctx.app).post(LOGIN).send({ email: EMAIL, password });
  const refresh = (refreshToken) =>
    request(ctx.app).post(REFRESH).set('Cookie', `${COOKIE}=${refreshToken}`);
  const storedHash = async () => (await User.findById(user._id).select('+password')).password;

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    await RefreshToken.init();
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await clearTestDb();
    user = await User.create({
      username: 'sara.k',
      email: EMAIL,
      password: await ctx.passwordHasher.hash(OLD_PASSWORD),
      isEmailVerified: true,
    });
    token = ctx.tokenService.signAccessToken(user);
  });

  it('changes the password: the new one logs in and the old one no longer does', async () => {
    const res = await change();

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(
      'Your password has been changed. Your other devices were logged out.',
    );
    expect((await login(NEW_PASSWORD)).status).toBe(200);
    expect((await login(OLD_PASSWORD)).status).toBe(401);
  });

  it('stores a bcrypt hash and never exposes a password or a hash', async () => {
    const res = await change();

    expect(await storedHash()).toMatch(/^\$2[aby]\$/);
    expect(JSON.stringify(res.body)).not.toMatch(/Brandnew456|Secret123|\$2[aby]\$/);
  });

  it('keeps the current access token working', async () => {
    await change();

    const me = await request(ctx.app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`);

    expect(me.status).toBe(200);
  });

  it('gives this device a fresh refresh cookie that works, and says not to cache it', async () => {
    const res = await change();

    expect(cookieHeaderOf(res)).toContain('HttpOnly');
    expect(cookieHeaderOf(res)).toContain('Path=/api/v1/auth');
    expect(cookieHeaderOf(res)).toContain('SameSite=Strict');
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await refresh(tokenOf(res))).status).toBe(200);
  });

  it('ends every other session of the user, on every device', async () => {
    const phone = tokenOf(await login(OLD_PASSWORD));
    const laptop = tokenOf(await login(OLD_PASSWORD));

    const res = await change();

    expect((await refresh(phone)).status).toBe(401);
    expect((await refresh(laptop)).status).toBe(401);
    expect(await RefreshToken.countDocuments({ user: user._id })).toBe(1);
    expect(tokenOf(res)).not.toBe(phone);
  });

  it('leaves the sessions of other users alone', async () => {
    await User.create({
      username: 'omar.b',
      email: 'omar@isamm.uma.tn',
      password: await ctx.passwordHasher.hash(OLD_PASSWORD),
      isEmailVerified: true,
    });
    const omar = tokenOf(
      await request(ctx.app)
        .post(LOGIN)
        .send({ email: 'omar@isamm.uma.tn', password: OLD_PASSWORD }),
    );

    await change();

    expect((await refresh(omar)).status).toBe(200);
  });

  it('does not touch the email, the verified flag or the role', async () => {
    await change();

    const current = await User.findById(user._id);
    expect(current.email).toBe(EMAIL);
    expect(current.isEmailVerified).toBe(true);
    expect(current.role).toBe('user');
  });

  describe('a wrong current password', () => {
    it('answers 400 on the field, not 401, and changes nothing', async () => {
      const other = tokenOf(await login(OLD_PASSWORD));
      const before = await storedHash();

      const res = await change({ currentPassword: 'Wrong12345' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([
        { field: 'currentPassword', message: 'Current password is incorrect' },
      ]);
      expect(cookieHeaderOf(res)).toBeUndefined();
      expect(await storedHash()).toBe(before);
      expect((await refresh(other)).status).toBe(200);
      expect((await login(OLD_PASSWORD)).status).toBe(200);
    });
  });

  describe('validation', () => {
    it('refuses a new password equal to the current one', async () => {
      const res = await change({ newPassword: OLD_PASSWORD, confirmPassword: OLD_PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        {
          field: 'newPassword',
          message: 'New password must be different from the current password',
        },
      ]);
    });

    it('refuses a weak new password before anything is checked', async () => {
      const res = await change({ newPassword: 'short1', confirmPassword: 'short1' });

      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('newPassword');
      expect((await login(OLD_PASSWORD)).status).toBe(200);
    });

    it('refuses a mismatched confirmPassword', async () => {
      const res = await change({ confirmPassword: 'Other123' });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { field: 'confirmPassword', message: 'Passwords do not match' },
      ]);
    });

    it('refuses an empty body and unknown fields', async () => {
      const empty = await request(ctx.app)
        .patch(URL)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(empty.status).toBe(400);

      const unknown = await change({ role: 'admin' });
      expect(unknown.status).toBe(400);
      expect(unknown.body.error.details).toEqual([
        { field: 'role', message: 'role is not allowed' },
      ]);
    });
  });

  describe('authentication', () => {
    it('answers 401 without a token, and changes nothing', async () => {
      const before = await storedHash();

      const res = await change({}, null);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(await storedHash()).toBe(before);
    });

    it('cuts off a suspended user at once', async () => {
      await User.updateOne({ _id: user._id }, { isActive: false });

      const res = await change();

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('answers 401 once the account is deleted', async () => {
      await User.updateOne({ _id: user._id }, { deletedAt: new Date() });

      expect((await change()).status).toBe(401);
    });

    it('only ever changes the password of the connected user', async () => {
      const other = await User.create({
        username: 'omar.b',
        email: 'omar@isamm.uma.tn',
        password: await ctx.passwordHasher.hash(OLD_PASSWORD),
      });
      const before = (await User.findById(other._id).select('+password')).password;

      await change();

      expect((await User.findById(other._id).select('+password')).password).toBe(before);
    });
  });
});
