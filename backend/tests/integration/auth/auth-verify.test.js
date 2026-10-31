import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/app.js';
import {
  CODE_MAX_ATTEMPTS,
  CODE_RESEND_COOLDOWN_MS,
  CODE_TTL_MS,
} from '../../../src/constants/auth/verification-code.js';
import { User } from '../../../src/models/users/user.model.js';
import { VerificationCode } from '../../../src/models/auth/verification-code.model.js';
import { createUserRepository } from '../../../src/repositories/users/user.repository.js';
import { createVerificationCodeRepository } from '../../../src/repositories/auth/verification-code.repository.js';
import { createAuthService } from '../../../src/services/auth/auth.service.js';
import { createCodeHasher } from '../../../src/services/auth/code-hasher.js';
import { EmailDeliveryError } from '../../../src/services/common/email.service.js';
import { createPasswordHasher } from '../../../src/services/auth/password-hasher.js';
import { createVerificationCodeService } from '../../../src/services/auth/verification-code.service.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const REGISTER_URL = '/api/v1/auth/register';
const VERIFY_URL = '/api/v1/auth/verify-email';
const RESEND_URL = '/api/v1/auth/resend-verification';
const EMAIL = 'sara@isamm.uma.tn';

const wrongCode = (code) => (code === '000000' ? '000001' : '000000');

describe('email verification routes', () => {
  let app;
  let now;

  const emailService = {
    sendVerificationCode: vi.fn(),
    sendPasswordResetCode: vi.fn(),
  };

  const advance = (ms) => {
    now += ms;
  };

  const lastSentCode = () => {
    const { calls } = emailService.sendVerificationCode.mock;
    return calls[calls.length - 1][1];
  };

  async function registerSara() {
    await request(app).post(REGISTER_URL).send({
      username: 'sara.k',
      email: EMAIL,
      password: 'Secret123',
      confirmPassword: 'Secret123',
    });
    return lastSentCode();
  }

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    await VerificationCode.init();

    const verificationCodeService = createVerificationCodeService({
      codeRepository: createVerificationCodeRepository(),
      codeHasher: createCodeHasher({ secret: 'a'.repeat(32) }),
      emailService,
      clock: () => new Date(now),
    });

    app = createApp({
      authService: createAuthService({
        userRepository: createUserRepository(),
        passwordHasher: createPasswordHasher({ cost: 4 }),
        verificationCodeService,
      }),
      allowedEmailDomains: ['isamm.uma.tn'],
    });
  });

  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  beforeEach(() => {
    now = Date.now();
    emailService.sendVerificationCode.mockReset();
    emailService.sendVerificationCode.mockResolvedValue(undefined);
  });

  describe('POST /auth/verify-email', () => {
    it('verifies the account with the right code', async () => {
      const code = await registerSara();

      const res = await request(app).post(VERIFY_URL).send({ email: EMAIL, code });

      expect(res.status).toBe(200);
      expect(res.body.user.isEmailVerified).toBe(true);
      expect((await User.findOne({ email: EMAIL })).isEmailVerified).toBe(true);
      expect(await VerificationCode.countDocuments()).toBe(0);
    });

    it('returns no token and sets no cookie', async () => {
      const code = await registerSara();

      const res = await request(app).post(VERIFY_URL).send({ email: EMAIL, code });

      expect(res.body.accessToken).toBeUndefined();
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('accepts the email in any case', async () => {
      const code = await registerSara();

      const res = await request(app).post(VERIFY_URL).send({ email: 'Sara@ISAMM.uma.tn', code });

      expect(res.status).toBe(200);
    });

    it('rejects a wrong code and leaves the account unverified', async () => {
      const code = await registerSara();

      const res = await request(app)
        .post(VERIFY_URL)
        .send({ email: EMAIL, code: wrongCode(code) });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CODE');
      expect((await User.findOne({ email: EMAIL })).isEmailVerified).toBe(false);
    });

    it('answers an unknown email exactly like a wrong code', async () => {
      const code = await registerSara();
      const wrong = await request(app)
        .post(VERIFY_URL)
        .send({ email: EMAIL, code: wrongCode(code) });

      const unknown = await request(app)
        .post(VERIFY_URL)
        .send({ email: 'nobody@isamm.uma.tn', code: '123456' });

      expect(unknown.status).toBe(wrong.status);
      expect(unknown.body).toEqual(wrong.body);
    });

    it('does not let a code be used twice', async () => {
      const code = await registerSara();
      await request(app).post(VERIFY_URL).send({ email: EMAIL, code });

      const res = await request(app).post(VERIFY_URL).send({ email: EMAIL, code });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CODE');
    });

    it('locks the code after too many wrong attempts, even for the right code', async () => {
      const code = await registerSara();

      for (let i = 0; i < CODE_MAX_ATTEMPTS; i += 1) {
        await request(app)
          .post(VERIFY_URL)
          .send({ email: EMAIL, code: wrongCode(code) });
      }
      const res = await request(app).post(VERIFY_URL).send({ email: EMAIL, code });

      expect(res.status).toBe(400);
      expect((await User.findOne({ email: EMAIL })).isEmailVerified).toBe(false);
    });

    it('rejects an expired code', async () => {
      const code = await registerSara();
      advance(CODE_TTL_MS + 1000);

      const res = await request(app).post(VERIFY_URL).send({ email: EMAIL, code });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CODE');
    });

    it('rejects a malformed code before touching the database', async () => {
      await registerSara();

      const res = await request(app).post(VERIFY_URL).send({ email: EMAIL, code: '12ab56' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].field).toBe('code');
      expect((await VerificationCode.findOne()).attempts).toBe(0);
    });

    it('rejects unknown fields', async () => {
      const code = await registerSara();

      const res = await request(app)
        .post(VERIFY_URL)
        .send({ email: EMAIL, code, isEmailVerified: true });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { field: 'isEmailVerified', message: 'isEmailVerified is not allowed' },
      ]);
    });
  });

  describe('POST /auth/resend-verification', () => {
    it('answers the same way for an unknown email, and sends nothing', async () => {
      await registerSara();
      emailService.sendVerificationCode.mockClear();
      advance(CODE_RESEND_COOLDOWN_MS);
      const known = await request(app).post(RESEND_URL).send({ email: EMAIL });
      emailService.sendVerificationCode.mockClear();

      const unknown = await request(app).post(RESEND_URL).send({ email: 'nobody@isamm.uma.tn' });

      expect(unknown.status).toBe(200);
      expect(unknown.body).toEqual(known.body);
      expect(emailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('sends nothing to an already verified account, but answers 200', async () => {
      const code = await registerSara();
      await request(app).post(VERIFY_URL).send({ email: EMAIL, code });
      emailService.sendVerificationCode.mockClear();

      const res = await request(app).post(RESEND_URL).send({ email: EMAIL });

      expect(res.status).toBe(200);
      expect(emailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('refuses inside the cooldown and says how long to wait', async () => {
      await registerSara();
      advance(30_000);

      const res = await request(app).post(RESEND_URL).send({ email: EMAIL });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(res.headers['retry-after']).toBe('90');
      expect(emailService.sendVerificationCode).toHaveBeenCalledTimes(1);
    });

    it('sends a new code after the cooldown, and that code verifies the account', async () => {
      const oldCode = await registerSara();
      advance(CODE_RESEND_COOLDOWN_MS);

      const res = await request(app).post(RESEND_URL).send({ email: EMAIL });
      const newCode = lastSentCode();

      expect(res.status).toBe(200);
      expect(emailService.sendVerificationCode).toHaveBeenCalledTimes(2);
      expect(await VerificationCode.countDocuments()).toBe(1);
      if (newCode !== oldCode) {
        const stale = await request(app).post(VERIFY_URL).send({ email: EMAIL, code: oldCode });
        expect(stale.status).toBe(400);
      }
      const verified = await request(app).post(VERIFY_URL).send({ email: EMAIL, code: newCode });
      expect(verified.status).toBe(200);
    });

    it('lets a user whose first email never arrived ask again at once', async () => {
      emailService.sendVerificationCode.mockRejectedValueOnce(new EmailDeliveryError('down'));
      await request(app).post(REGISTER_URL).send({
        username: 'sara.k',
        email: EMAIL,
        password: 'Secret123',
        confirmPassword: 'Secret123',
      });

      const res = await request(app).post(RESEND_URL).send({ email: EMAIL });

      expect(res.status).toBe(200);
      expect(emailService.sendVerificationCode).toHaveBeenCalledTimes(2);
    });

    it('answers 500 and keeps no code when the email cannot be delivered', async () => {
      emailService.sendVerificationCode.mockRejectedValueOnce(new EmailDeliveryError('down'));
      await request(app).post(REGISTER_URL).send({
        username: 'sara.k',
        email: EMAIL,
        password: 'Secret123',
        confirmPassword: 'Secret123',
      });
      emailService.sendVerificationCode.mockRejectedValueOnce(new EmailDeliveryError('down'));

      const res = await request(app).post(RESEND_URL).send({ email: EMAIL });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(await VerificationCode.countDocuments()).toBe(0);
    });

    it('rejects a malformed email', async () => {
      const res = await request(app).post(RESEND_URL).send({ email: 'nope' });

      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('email');
    });
  });
});
