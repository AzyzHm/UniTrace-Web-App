import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CODE_MAX_ATTEMPTS,
  CODE_RESEND_COOLDOWN_MS,
  CODE_TTL_MS,
} from '../../../src/constants/auth/verification-code.js';
import { RefreshToken } from '../../../src/models/auth/refresh-token.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { VerificationCode } from '../../../src/models/auth/verification-code.model.js';
import { EmailDeliveryError } from '../../../src/services/common/email.service.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const FORGOT = '/api/v1/auth/forgot-password';
const RESET = '/api/v1/auth/reset-password';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const VERIFY_EMAIL = '/api/v1/auth/verify-email';
const RESEND_VERIFICATION = '/api/v1/auth/resend-verification';
const EMAIL = 'sara@isamm.uma.tn';
const OLD_PASSWORD = 'Secret123';
const NEW_PASSWORD = 'Brandnew456';
const COOKIE = 'refreshToken';

const wrongCode = (code) => (code === '000000' ? '000001' : '000000');
const cookieHeaderOf = (res) => res.headers['set-cookie']?.find((c) => c.startsWith(`${COOKIE}=`));
const tokenOf = (res) =>
  cookieHeaderOf(res)
    .split(';')[0]
    .slice(COOKIE.length + 1);

describe('password reset routes', () => {
  let ctx;
  let user;

  const lastCode = (method) => {
    const { calls } = ctx.emailService[method].mock;
    return calls[calls.length - 1][1];
  };
  const lastResetCode = () => lastCode('sendPasswordResetCode');

  const forgot = (email = EMAIL) => request(ctx.app).post(FORGOT).send({ email });

  const reset = (code, overrides = {}) =>
    request(ctx.app)
      .post(RESET)
      .send({
        email: EMAIL,
        code,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        ...overrides,
      });

  const login = (password, email = EMAIL) => request(ctx.app).post(LOGIN).send({ email, password });

  async function createUser(overrides = {}) {
    return User.create({
      username: 'sara.k',
      email: EMAIL,
      password: await ctx.passwordHasher.hash(OLD_PASSWORD),
      isEmailVerified: true,
      ...overrides,
    });
  }

  const storedHash = async () =>
    (await User.findOne({ email: EMAIL }).select('+password')).password;

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    await VerificationCode.init();
    await RefreshToken.init();
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await clearTestDb();
    for (const method of ['sendPasswordResetCode', 'sendVerificationCode']) {
      ctx.emailService[method].mockReset();
      ctx.emailService[method].mockResolvedValue(undefined);
    }
    user = await createUser();
  });

  describe('POST /auth/forgot-password', () => {
    it('emails a 6 digit code and stores only its hash, as a password reset code', async () => {
      const res = await forgot();

      expect(res.status).toBe(200);
      expect(ctx.emailService.sendPasswordResetCode).toHaveBeenCalledTimes(1);
      const [to, code] = ctx.emailService.sendPasswordResetCode.mock.calls[0];
      expect(to).toBe(EMAIL);
      expect(code).toMatch(/^\d{6}$/);

      const stored = await VerificationCode.findOne();
      expect(String(stored.user)).toBe(String(user._id));
      expect(stored.purpose).toBe('password_reset');
      expect(stored.codeHash).not.toContain(code);
      expect(JSON.stringify(res.body)).not.toContain(code);
    });

    it('accepts the email in any case', async () => {
      const res = await forgot('Sara@ISAMM.uma.tn');

      expect(res.status).toBe(200);
      expect(ctx.emailService.sendPasswordResetCode).toHaveBeenCalledTimes(1);
    });

    it('answers an unknown email exactly like a known one, and sends nothing', async () => {
      const known = await forgot();
      ctx.emailService.sendPasswordResetCode.mockClear();

      const unknown = await forgot('nobody@isamm.uma.tn');

      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);
      expect(ctx.emailService.sendPasswordResetCode).not.toHaveBeenCalled();
    });

    it('also works for an account whose email is not verified yet', async () => {
      await User.updateOne({ _id: user._id }, { isEmailVerified: false });

      const res = await forgot();

      expect(res.status).toBe(200);
      expect(ctx.emailService.sendPasswordResetCode).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a suspended account', { isActive: false }],
      ['a deleted account', { deletedAt: new Date() }],
    ])('answers 200 but sends nothing for %s', async (_label, change) => {
      await User.updateOne({ _id: user._id }, change);

      const res = await forgot();

      expect(res.status).toBe(200);
      expect(ctx.emailService.sendPasswordResetCode).not.toHaveBeenCalled();
      expect(await VerificationCode.countDocuments()).toBe(0);
    });

    it('refuses inside the cooldown and says how long to wait', async () => {
      await forgot();
      ctx.advance(30_000);

      const res = await forgot();

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(res.headers['retry-after']).toBe('90');
      expect(ctx.emailService.sendPasswordResetCode).toHaveBeenCalledTimes(1);
    });

    it('sends a new code after the cooldown, and the old one stops working', async () => {
      await forgot();
      const oldCode = lastResetCode();
      ctx.advance(CODE_RESEND_COOLDOWN_MS);

      const res = await forgot();
      const newCode = lastResetCode();

      expect(res.status).toBe(200);
      expect(await VerificationCode.countDocuments()).toBe(1);
      if (newCode !== oldCode) {
        expect((await reset(oldCode)).status).toBe(400);
      }
      expect((await reset(newCode)).status).toBe(200);
    });

    it('answers 500 and keeps no code when the email cannot be delivered', async () => {
      ctx.emailService.sendPasswordResetCode.mockRejectedValueOnce(new EmailDeliveryError('down'));

      const res = await forgot();

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(await VerificationCode.countDocuments()).toBe(0);
    });

    it('rejects a malformed email', async () => {
      const res = await forgot('nope');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].field).toBe('email');
    });
  });

  describe('POST /auth/reset-password', () => {
    it('changes the password: the new one logs in and the old one no longer does', async () => {
      await forgot();

      const res = await reset(lastResetCode());

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Your password has been changed. Please log in again.');
      expect((await login(NEW_PASSWORD)).status).toBe(200);
      expect((await login(OLD_PASSWORD)).status).toBe(401);
    });

    it('stores a bcrypt hash and never exposes the password', async () => {
      await forgot();

      const res = await reset(lastResetCode());

      expect(await storedHash()).toMatch(/^\$2[aby]\$/);
      expect(JSON.stringify(res.body)).not.toMatch(/Brandnew456|\$2[aby]\$/);
    });

    it('does not log the user in', async () => {
      await forgot();

      const res = await reset(lastResetCode());

      expect(res.body.accessToken).toBeUndefined();
      expect(cookieHeaderOf(res)).toMatch(/^refreshToken=;/);
    });

    it('removes the refresh cookie of this browser, with the path it was set with', async () => {
      await forgot();

      const res = await reset(lastResetCode());

      expect(cookieHeaderOf(res)).toContain('Path=/api/v1/auth');
      expect(cookieHeaderOf(res)).toContain('Expires=Thu, 01 Jan 1970');
    });

    it('leaves isEmailVerified as it was', async () => {
      await User.updateOne({ _id: user._id }, { isEmailVerified: false });
      await forgot();

      await reset(lastResetCode());

      expect((await User.findById(user._id)).isEmailVerified).toBe(false);
    });

    it('can be used only once', async () => {
      await forgot();
      const code = lastResetCode();
      await reset(code);

      const res = await reset(code, { newPassword: 'Another789', confirmPassword: 'Another789' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CODE');
      expect((await login(NEW_PASSWORD)).status).toBe(200);
    });

    it('lets exactly one of two simultaneous resets with the same code win', async () => {
      await forgot();
      const code = lastResetCode();

      const [first, second] = await Promise.all([reset(code), reset(code)]);

      expect([first.status, second.status].sort()).toEqual([200, 400]);
    });

    it('rejects a wrong code and leaves the password alone', async () => {
      await forgot();
      const before = await storedHash();

      const res = await reset(wrongCode(lastResetCode()));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CODE');
      expect(await storedHash()).toBe(before);
      expect((await login(OLD_PASSWORD)).status).toBe(200);
    });

    it('answers an unknown email exactly like a wrong code', async () => {
      await forgot();
      const wrong = await reset(wrongCode(lastResetCode()));

      const unknown = await reset('123456', { email: 'nobody@isamm.uma.tn' });

      expect(unknown.status).toBe(wrong.status);
      expect(unknown.body).toEqual(wrong.body);
    });

    it('locks the code after too many wrong attempts, even for the right code', async () => {
      await forgot();
      const code = lastResetCode();

      for (let i = 0; i < CODE_MAX_ATTEMPTS; i += 1) {
        await reset(wrongCode(code));
      }
      const res = await reset(code);

      expect(res.status).toBe(400);
      expect((await login(OLD_PASSWORD)).status).toBe(200);
    });

    it('rejects an expired code', async () => {
      await forgot();
      const code = lastResetCode();
      ctx.advance(CODE_TTL_MS + 1000);

      const res = await reset(code);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CODE');
    });

    it('refuses a suspended account even with a valid code, and leaves the password alone', async () => {
      await forgot();
      const code = lastResetCode();
      await User.updateOne({ _id: user._id }, { isActive: false });
      const before = await storedHash();

      const res = await reset(code);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CODE');
      expect(await storedHash()).toBe(before);
    });

    it('rejects a weak password before the code is used, so the user can try again', async () => {
      await forgot();
      const code = lastResetCode();

      const weak = await reset(code, { newPassword: 'short1', confirmPassword: 'short1' });

      expect(weak.status).toBe(400);
      expect(weak.body.error.code).toBe('VALIDATION_ERROR');
      expect(weak.body.error.details[0].field).toBe('newPassword');
      expect((await VerificationCode.findOne()).attempts).toBe(0);
      expect((await reset(code)).status).toBe(200);
    });

    it('rejects a mismatched confirmPassword', async () => {
      await forgot();

      const res = await reset(lastResetCode(), { confirmPassword: 'Other123' });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { field: 'confirmPassword', message: 'Passwords do not match' },
      ]);
    });

    it('rejects unknown fields', async () => {
      await forgot();

      const res = await reset(lastResetCode(), { role: 'admin' });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field: 'role', message: 'role is not allowed' }]);
    });

    it('ends every session of the user, so no old refresh token works any more', async () => {
      const phone = tokenOf(await login(OLD_PASSWORD));
      const laptop = tokenOf(await login(OLD_PASSWORD));
      await forgot();

      await reset(lastResetCode());

      for (const token of [phone, laptop]) {
        const res = await request(ctx.app).post(REFRESH).set('Cookie', `${COOKIE}=${token}`);
        expect(res.status).toBe(401);
      }
      expect(await RefreshToken.countDocuments({ user: user._id })).toBe(0);
    });

    it('leaves the sessions of other users alone', async () => {
      await createUser({ username: 'omar.b', email: 'omar@isamm.uma.tn' });
      const omar = tokenOf(await login(OLD_PASSWORD, 'omar@isamm.uma.tn'));
      await forgot();

      await reset(lastResetCode());
      const res = await request(ctx.app).post(REFRESH).set('Cookie', `${COOKIE}=${omar}`);

      expect(res.status).toBe(200);
    });
  });

  describe('codes of different purposes', () => {
    beforeEach(async () => {
      await User.updateOne({ _id: user._id }, { isEmailVerified: false });
    });

    it('does not let a password reset code verify an email', async () => {
      await forgot();

      const res = await request(ctx.app)
        .post(VERIFY_EMAIL)
        .send({ email: EMAIL, code: lastResetCode() });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CODE');
      expect((await User.findById(user._id)).isEmailVerified).toBe(false);
    });

    it('does not let an email verification code reset a password', async () => {
      await request(ctx.app).post(RESEND_VERIFICATION).send({ email: EMAIL });
      const before = await storedHash();

      const res = await reset(lastCode('sendVerificationCode'));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CODE');
      expect(await storedHash()).toBe(before);
    });
  });
});
