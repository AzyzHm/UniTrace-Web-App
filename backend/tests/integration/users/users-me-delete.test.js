import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../../src/constants/common/events.js';
import { RefreshToken } from '../../../src/models/auth/refresh-token.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { VerificationCode } from '../../../src/models/auth/verification-code.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const URL = '/api/v1/users/me';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const REGISTER = '/api/v1/auth/register';
const FORGOT = '/api/v1/auth/forgot-password';
const EMAIL = 'sara@isamm.uma.tn';
const PASSWORD = 'Secret123';
const COOKIE = 'refreshToken';

const cookieHeaderOf = (res) => res.headers['set-cookie']?.find((c) => c.startsWith(`${COOKIE}=`));
const tokenOf = (res) =>
  cookieHeaderOf(res)
    .split(';')[0]
    .slice(COOKIE.length + 1);

describe('DELETE /api/v1/users/me', () => {
  let ctx;
  let user;
  let token;
  let onDeleted;
  let unsubscribe;

  const remove = (body = { password: PASSWORD }, header = `Bearer ${token}`) => {
    const req = request(ctx.app).delete(URL).send(body);
    return header ? req.set('Authorization', header) : req;
  };
  const login = (email = EMAIL, password = PASSWORD) =>
    request(ctx.app).post(LOGIN).send({ email, password });
  const refresh = (refreshToken) =>
    request(ctx.app).post(REFRESH).set('Cookie', `${COOKIE}=${refreshToken}`);
  const stored = () => User.findById(user._id).select('+password');

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    await RefreshToken.init();
    await VerificationCode.init();
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);

  afterEach(() => unsubscribe.forEach((off) => off()));

  beforeEach(async () => {
    await clearTestDb();
    ctx.emailService.sendVerificationCode.mockClear();
    ctx.emailService.sendPasswordResetCode.mockClear();
    onDeleted = vi.fn();
    unsubscribe = [ctx.eventBus.on(EVENTS.USER_DELETED, onDeleted)];
    user = await User.create({
      username: 'sara.k',
      email: EMAIL,
      phone: '+21655000000',
      password: await ctx.passwordHasher.hash(PASSWORD),
      isEmailVerified: true,
    });
    token = ctx.tokenService.signAccessToken(user);
  });

  it('answers 204 with no body and removes the refresh cookie', async () => {
    const res = await remove();

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(cookieHeaderOf(res)).toMatch(/^refreshToken=;/);
    expect(cookieHeaderOf(res)).toContain('Path=/api/v1/auth');
    expect(cookieHeaderOf(res)).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('anonymizes the account and keeps nothing that identifies the person', async () => {
    await remove();

    const current = await stored();
    expect(current.username).toBe(`deleted_user_${user._id}`);
    expect(current.email).toBe(`deleted_${user._id}@deleted.invalid`);
    expect(current.phone).toBeNull();
    expect(current.password).toBe('!');
    expect(current.isEmailVerified).toBe(false);
    expect(current.deletedAt).toBeInstanceOf(Date);
    expect(current.role).toBe('user');
    expect(JSON.stringify(current)).not.toMatch(/sara|21655000000|\$2[aby]\$/);
  });

  it('cuts off the access token at once', async () => {
    await remove();

    const me = await request(ctx.app).get(URL).set('Authorization', `Bearer ${token}`);

    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('ends every session of the user, on every device', async () => {
    const phone = tokenOf(await login());
    const laptop = tokenOf(await login());

    await remove();

    expect((await refresh(phone)).status).toBe(401);
    expect((await refresh(laptop)).status).toBe(401);
    expect(await RefreshToken.countDocuments({ user: user._id })).toBe(0);
  });

  it('removes a pending verification or reset code', async () => {
    await request(ctx.app).post(FORGOT).send({ email: EMAIL });
    expect(await VerificationCode.countDocuments({ user: user._id })).toBe(1);

    await remove();

    expect(await VerificationCode.countDocuments({ user: user._id })).toBe(0);
  });

  it('can no longer log in with the old email, and nobody can log in to the placeholder', async () => {
    await remove();

    expect((await login()).status).toBe(401);
    expect((await login(`deleted_${user._id}@deleted.invalid`, '!')).status).toBe(400);
  });

  it('does not send a reset code to the old address any more', async () => {
    await remove();

    await request(ctx.app).post(FORGOT).send({ email: EMAIL });

    expect(ctx.emailService.sendPasswordResetCode).not.toHaveBeenCalled();
  });

  it('frees the email and the username for a new registration', async () => {
    await remove();

    const res = await request(ctx.app).post(REGISTER).send({
      username: 'sara.k',
      email: EMAIL,
      password: 'Another123',
      confirmPassword: 'Another123',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.id).not.toBe(String(user._id));
  });

  it('announces user.deleted once, with the id and the time', async () => {
    await remove();

    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledWith({
      userId: String(user._id),
      deletedAt: expect.any(Date),
    });
  });

  it('still deletes the account when a listener of the event fails', async () => {
    unsubscribe.push(
      ctx.eventBus.on(EVENTS.USER_DELETED, () => {
        throw new Error('listener broke');
      }),
    );

    const res = await remove();

    expect(res.status).toBe(204);
    expect((await stored()).deletedAt).toBeInstanceOf(Date);
  });

  it('leaves other users, and their sessions, alone', async () => {
    const omar = await User.create({
      username: 'omar.b',
      email: 'omar@isamm.uma.tn',
      password: await ctx.passwordHasher.hash(PASSWORD),
      isEmailVerified: true,
    });
    const omarToken = tokenOf(await login('omar@isamm.uma.tn'));

    await remove();

    const untouched = await User.findById(omar._id);
    expect(untouched.username).toBe('omar.b');
    expect(untouched.deletedAt).toBeNull();
    expect((await refresh(omarToken)).status).toBe(200);
  });

  it('lets exactly one of two simultaneous deletions win', async () => {
    const [first, second] = await Promise.all([remove(), remove()]);

    expect([first.status, second.status].sort()).toEqual([204, 401]);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  describe('a wrong password', () => {
    it('answers 400 on the field, not 401, and deletes nothing', async () => {
      const other = tokenOf(await login());

      const res = await remove({ password: 'Wrong12345' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([
        { field: 'password', message: 'Password is incorrect' },
      ]);
      expect(cookieHeaderOf(res)).toBeUndefined();
      const current = await stored();
      expect(current.deletedAt).toBeNull();
      expect(current.email).toBe(EMAIL);
      expect(onDeleted).not.toHaveBeenCalled();
      expect((await refresh(other)).status).toBe(200);
    });
  });

  describe('validation', () => {
    it.each([
      ['no password', {}],
      ['an empty password', { password: '' }],
      ['an unknown field', { password: PASSWORD, email: EMAIL }],
      ['an operator object', { password: { $ne: '' } }],
    ])('refuses %s with a 400 and deletes nothing', async (_label, body) => {
      const res = await remove(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect((await stored()).deletedAt).toBeNull();
    });
  });

  describe('authentication', () => {
    it('answers 401 without a token, and deletes nothing', async () => {
      const res = await remove({ password: PASSWORD }, null);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect((await stored()).deletedAt).toBeNull();
    });

    it('answers 401 for an account that is already deleted', async () => {
      await remove();

      expect((await remove()).status).toBe(401);
    });

    it('only ever deletes the connected user', async () => {
      const other = await User.create({
        username: 'omar.b',
        email: 'omar@isamm.uma.tn',
        password: await ctx.passwordHasher.hash(PASSWORD),
      });

      await remove();

      expect((await User.findById(other._id)).deletedAt).toBeNull();
    });
  });
});
