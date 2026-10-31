import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CODE_RESEND_COOLDOWN_MS } from '../../../src/constants/auth/verification-code.js';
import { User } from '../../../src/models/users/user.model.js';
import { VerificationCode } from '../../../src/models/auth/verification-code.model.js';
import { EmailDeliveryError } from '../../../src/services/common/email.service.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const URL = '/api/v1/users/me';
const LOGIN = '/api/v1/auth/login';
const VERIFY_EMAIL = '/api/v1/auth/verify-email';
const RESEND_VERIFICATION = '/api/v1/auth/resend-verification';
const OLD_EMAIL = 'sara@isamm.uma.tn';
const NEW_EMAIL = 'sara.new@isamm.uma.tn';
const PASSWORD = 'Secret123';

describe('PATCH /api/v1/users/me', () => {
  let ctx;
  let user;
  let token;

  const patch = (body, header = `Bearer ${token}`) => {
    const req = request(ctx.app).patch(URL).send(body);
    return header ? req.set('Authorization', header) : req;
  };
  const login = (email) => request(ctx.app).post(LOGIN).send({ email, password: PASSWORD });
  const lastCode = () => {
    const { calls } = ctx.emailService.sendVerificationCode.mock;
    return calls[calls.length - 1][1];
  };
  const stored = () => User.findById(user._id);

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    await VerificationCode.init();
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await clearTestDb();
    ctx.emailService.sendVerificationCode.mockReset();
    ctx.emailService.sendVerificationCode.mockResolvedValue(undefined);
    user = await User.create({
      username: 'sara.k',
      email: OLD_EMAIL,
      password: await ctx.passwordHasher.hash(PASSWORD),
      isEmailVerified: true,
    });
    token = ctx.tokenService.signAccessToken(user);
  });

  describe('username and phone', () => {
    it('updates the username and returns the safe user shape', async () => {
      const res = await patch({ username: 'sara.k2' });

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('sara.k2');
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
      expect((await stored()).username).toBe('sara.k2');
    });

    it('sets a phone number, then removes it with null', async () => {
      const set = await patch({ phone: '+21655000000' });
      expect(set.body.user.phone).toBe('+21655000000');

      const cleared = await patch({ phone: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.user.phone).toBeNull();
      expect((await stored()).phone).toBeNull();
    });

    it('does not touch the email, the verified flag or the sessions', async () => {
      const res = await patch({ username: 'sara.k2' });

      expect(res.body.user.email).toBe(OLD_EMAIL);
      expect(res.body.user.isEmailVerified).toBe(true);
      expect(res.body.message).toBeUndefined();
      expect(ctx.emailService.sendVerificationCode).not.toHaveBeenCalled();
      expect((await patch({ username: 'sara.k3' })).status).toBe(200);
    });

    it('lets the user change the casing of their own username', async () => {
      const res = await patch({ username: 'Sara.K' });

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('Sara.K');
    });

    it('answers 200 and changes nothing when the values are already the current ones', async () => {
      const res = await patch({ username: 'sara.k', email: OLD_EMAIL });

      expect(res.status).toBe(200);
      expect(res.body.user.isEmailVerified).toBe(true);
      expect(ctx.emailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('answers 409 for a username taken by someone else, ignoring case', async () => {
      await User.create({
        username: 'Omar.B',
        email: 'omar@isamm.uma.tn',
        password: await ctx.passwordHasher.hash(PASSWORD),
      });

      const res = await patch({ username: 'omar.b' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.details).toEqual([
        { field: 'username', message: 'Username is already taken' },
      ]);
      expect((await stored()).username).toBe('sara.k');
    });
  });

  describe('email', () => {
    it('saves the new address as not verified and emails a code to it', async () => {
      const res = await patch({ email: 'Sara.New@ISAMM.uma.tn' });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(NEW_EMAIL);
      expect(res.body.user.isEmailVerified).toBe(false);
      expect(res.body.message).toMatch(/Enter the code sent to the new address/);
      expect(ctx.emailService.sendVerificationCode).toHaveBeenCalledTimes(1);
      const [to, code] = ctx.emailService.sendVerificationCode.mock.calls[0];
      expect(to).toBe(NEW_EMAIL);
      expect(code).toMatch(/^\d{6}$/);
      expect(JSON.stringify(res.body)).not.toContain(code);

      const record = await VerificationCode.findOne();
      expect(String(record.user)).toBe(String(user._id));
      expect(record.purpose).toBe('email_verification');
      expect(record.codeHash).not.toContain(code);
    });

    it('keeps the current session working, so a typo can be fixed', async () => {
      await patch({ email: 'typo@isamm.uma.tn' });

      const me = await request(ctx.app).get(URL).set('Authorization', `Bearer ${token}`);
      expect(me.status).toBe(200);

      const fixed = await patch({ email: NEW_EMAIL });
      expect(fixed.status).toBe(200);
      expect(fixed.body.user.email).toBe(NEW_EMAIL);
    });

    it('can be verified with the code, using the new address', async () => {
      await patch({ email: NEW_EMAIL });

      const res = await request(ctx.app)
        .post(VERIFY_EMAIL)
        .send({ email: NEW_EMAIL, code: lastCode() });

      expect(res.status).toBe(200);
      expect(res.body.user.isEmailVerified).toBe(true);
      expect((await stored()).isEmailVerified).toBe(true);
    });

    it('moves login to the new address: old one is unknown, new one needs the code first', async () => {
      await patch({ email: NEW_EMAIL });

      const oldLogin = await login(OLD_EMAIL);
      expect(oldLogin.status).toBe(401);
      expect(oldLogin.body.error.code).toBe('UNAUTHENTICATED');

      const unverified = await login(NEW_EMAIL);
      expect(unverified.status).toBe(403);
      expect(unverified.body.error.code).toBe('EMAIL_NOT_VERIFIED');

      await request(ctx.app).post(VERIFY_EMAIL).send({ email: NEW_EMAIL, code: lastCode() });
      expect((await login(NEW_EMAIL)).status).toBe(200);
    });

    it('answers 409 for an address that already has an account, and sends nothing', async () => {
      await User.create({
        username: 'omar.b',
        email: 'omar@isamm.uma.tn',
        password: await ctx.passwordHasher.hash(PASSWORD),
        isEmailVerified: true,
      });

      const res = await patch({ email: 'omar@isamm.uma.tn' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.details).toEqual([
        { field: 'email', message: 'Email is already used' },
      ]);
      expect(ctx.emailService.sendVerificationCode).not.toHaveBeenCalled();
      expect(await VerificationCode.countDocuments()).toBe(0);
      const current = await stored();
      expect(current.email).toBe(OLD_EMAIL);
      expect(current.isEmailVerified).toBe(true);
    });

    it('changes nothing at all when one field of the request conflicts', async () => {
      await User.create({
        username: 'Omar.B',
        email: 'omar@isamm.uma.tn',
        password: await ctx.passwordHasher.hash(PASSWORD),
      });

      const res = await patch({ username: 'new.name', email: 'omar@isamm.uma.tn' });

      expect(res.status).toBe(409);
      expect((await stored()).username).toBe('sara.k');
    });

    it('refuses an address outside the university domains', async () => {
      const res = await patch({ email: 'sara@gmail.com' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([
        { field: 'email', message: 'Please use your university email address' },
      ]);
      expect((await stored()).email).toBe(OLD_EMAIL);
    });

    it('keeps the change and says the code was not sent when the email cannot be delivered', async () => {
      ctx.emailService.sendVerificationCode.mockRejectedValueOnce(new EmailDeliveryError('down'));

      const res = await patch({ email: NEW_EMAIL });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(NEW_EMAIL);
      expect(res.body.user.isEmailVerified).toBe(false);
      expect(res.body.message).toMatch(/could not be sent/);
      expect(await VerificationCode.countDocuments()).toBe(0);
    });

    it('keeps the change and says the code was not sent inside the resend cooldown, then recovers', async () => {
      await patch({ email: 'typo@isamm.uma.tn' });

      const second = await patch({ email: NEW_EMAIL });

      expect(second.status).toBe(200);
      expect(second.body.user.email).toBe(NEW_EMAIL);
      expect(second.body.message).toMatch(/could not be sent/);
      expect(ctx.emailService.sendVerificationCode).toHaveBeenCalledTimes(1);

      ctx.advance(CODE_RESEND_COOLDOWN_MS);
      const resend = await request(ctx.app).post(RESEND_VERIFICATION).send({ email: NEW_EMAIL });
      expect(resend.status).toBe(200);
      expect(ctx.emailService.sendVerificationCode).toHaveBeenCalledTimes(2);
      expect(ctx.emailService.sendVerificationCode.mock.calls[1][0]).toBe(NEW_EMAIL);

      const verified = await request(ctx.app)
        .post(VERIFY_EMAIL)
        .send({ email: NEW_EMAIL, code: lastCode() });
      expect(verified.status).toBe(200);
    });
  });

  describe('validation', () => {
    it('refuses an empty body', async () => {
      const res = await patch({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].message).toBe('Send at least one field to update');
    });

    it.each([
      ['role', 'admin'],
      ['isActive', false],
      ['isEmailVerified', true],
      ['password', 'Hacked123'],
      ['deletedAt', '2026-01-01'],
    ])('refuses "%s" and changes nothing', async (field, value) => {
      const res = await patch({ username: 'sara.k2', [field]: value });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field, message: `${field} is not allowed` }]);
      const current = await stored();
      expect(current.username).toBe('sara.k');
      expect(current.role).toBe('user');
      expect(current.isActive).toBe(true);
    });

    it('refuses NoSQL operator objects instead of passing them to the database', async () => {
      const res = await patch({ email: { $ne: '' } });

      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('email');
    });

    it('refuses a malformed username and phone, listing both', async () => {
      const res = await patch({ username: 'a b', phone: '123' });

      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['phone', 'username']);
    });
  });

  describe('authentication', () => {
    it('answers 401 without a token, and changes nothing', async () => {
      const res = await patch({ username: 'sara.k2' }, null);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect((await stored()).username).toBe('sara.k');
    });

    it('cuts off a suspended user at once', async () => {
      await User.updateOne({ _id: user._id }, { isActive: false });

      const res = await patch({ username: 'sara.k2' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect((await stored()).username).toBe('sara.k');
    });

    it('answers 401 once the account is deleted', async () => {
      await User.updateOne({ _id: user._id }, { deletedAt: new Date() });

      const res = await patch({ username: 'sara.k2' });

      expect(res.status).toBe(401);
    });

    it('only ever changes the connected user', async () => {
      const other = await User.create({
        username: 'omar.b',
        email: 'omar@isamm.uma.tn',
        password: await ctx.passwordHasher.hash(PASSWORD),
      });

      await patch({ username: 'sara.k2' });

      expect((await User.findById(other._id)).username).toBe('omar.b');
    });
  });
});
