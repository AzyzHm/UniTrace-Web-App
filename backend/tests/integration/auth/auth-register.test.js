import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/app.js';
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

const URL = '/api/v1/auth/register';

function buildBody(overrides = {}) {
  return {
    username: 'sara.k',
    email: 'sara@isamm.uma.tn',
    phone: '+21612345678',
    password: 'Secret123',
    confirmPassword: 'Secret123',
    ...overrides,
  };
}

describe('POST /api/v1/auth/register', () => {
  let app;

  const emailService = {
    sendVerificationCode: vi.fn(),
    sendPasswordResetCode: vi.fn(),
  };

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    await VerificationCode.init();

    const verificationCodeService = createVerificationCodeService({
      codeRepository: createVerificationCodeRepository(),
      codeHasher: createCodeHasher({ secret: 'a'.repeat(32) }),
      emailService,
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
    emailService.sendVerificationCode.mockReset();
    emailService.sendVerificationCode.mockResolvedValue(undefined);
  });

  it('creates an unverified user and answers 201 with a safe shape', async () => {
    const res = await request(app).post(URL).send(buildBody());

    expect(res.status).toBe(201);
    expect(Object.keys(res.body.user).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'isEmailVerified',
      'phone',
      'role',
      'username',
    ]);
    expect(res.body.user.role).toBe('user');
    expect(res.body.user.isEmailVerified).toBe(false);
  });

  it('returns no token and sets no cookie', async () => {
    const res = await request(app).post(URL).send(buildBody());

    expect(res.body.accessToken).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('never exposes the password, plain or hashed', async () => {
    const res = await request(app).post(URL).send(buildBody());

    expect(JSON.stringify(res.body)).not.toMatch(/password|Secret123|\$2[aby]\$/i);
  });

  it('stores a bcrypt hash and a lowercased email', async () => {
    await request(app)
      .post(URL)
      .send(buildBody({ email: 'Sara@ISAMM.uma.tn' }));

    const stored = await User.findOne().select('+password');
    expect(stored.password).toMatch(/^\$2[aby]\$/);
    expect(stored.email).toBe('sara@isamm.uma.tn');
  });

  it('rejects a role in the body and creates nothing', async () => {
    const res = await request(app)
      .post(URL)
      .send(buildBody({ role: 'admin' }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'role', message: 'role is not allowed' }]);
    expect(await User.countDocuments()).toBe(0);
  });

  it('rejects a mismatched confirmPassword', async () => {
    const res = await request(app)
      .post(URL)
      .send(buildBody({ confirmPassword: 'Other123' }));

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { field: 'confirmPassword', message: 'Passwords do not match' },
    ]);
  });

  it('rejects a non university email', async () => {
    const res = await request(app)
      .post(URL)
      .send(buildBody({ email: 'sara@gmail.com' }));

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('email');
  });

  it('answers 409 for a duplicate email', async () => {
    await request(app).post(URL).send(buildBody());

    const res = await request(app)
      .post(URL)
      .send(buildBody({ username: 'other.user' }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details).toEqual([{ field: 'email', message: 'Email is already used' }]);
  });

  it('answers 409 for a duplicate username, ignoring case', async () => {
    await request(app)
      .post(URL)
      .send(buildBody({ username: 'Sara.K' }));

    const res = await request(app)
      .post(URL)
      .send(buildBody({ username: 'sara.k', email: 'other@isamm.uma.tn' }));

    expect(res.status).toBe(409);
    expect(res.body.error.details[0].field).toBe('username');
  });

  it('lets exactly one of two simultaneous registrations win', async () => {
    const [first, second] = await Promise.all([
      request(app).post(URL).send(buildBody()),
      request(app).post(URL).send(buildBody()),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await User.countDocuments()).toBe(1);
  });

  describe('verification code', () => {
    it('emails a 6 digit code and stores only its hash, linked to the new user', async () => {
      const res = await request(app).post(URL).send(buildBody());

      expect(emailService.sendVerificationCode).toHaveBeenCalledTimes(1);
      const [to, code] = emailService.sendVerificationCode.mock.calls[0];
      expect(to).toBe('sara@isamm.uma.tn');
      expect(code).toMatch(/^\d{6}$/);

      const stored = await VerificationCode.findOne();
      expect(String(stored.user)).toBe(res.body.user.id);
      expect(stored.purpose).toBe('email_verification');
      expect(stored.codeHash).not.toContain(code);
      expect(res.body.code).toBeUndefined();
    });

    it('still answers 201 and keeps the account when the email cannot be delivered', async () => {
      emailService.sendVerificationCode.mockRejectedValueOnce(new EmailDeliveryError('down'));

      const res = await request(app).post(URL).send(buildBody());

      expect(res.status).toBe(201);
      expect(await User.countDocuments()).toBe(1);
      // The unsent code is removed, so the user can ask for a new one at once.
      expect(await VerificationCode.countDocuments()).toBe(0);
    });

    it('sends no second email for a refused duplicate registration', async () => {
      await request(app).post(URL).send(buildBody());
      emailService.sendVerificationCode.mockClear();

      const res = await request(app)
        .post(URL)
        .send(buildBody({ username: 'other.user' }));

      expect(res.status).toBe(409);
      expect(emailService.sendVerificationCode).not.toHaveBeenCalled();
      expect(await VerificationCode.countDocuments()).toBe(1);
    });

    it('sends exactly one email when two identical registrations race', async () => {
      await Promise.all([
        request(app).post(URL).send(buildBody()),
        request(app).post(URL).send(buildBody()),
      ]);

      expect(emailService.sendVerificationCode).toHaveBeenCalledTimes(1);
      expect(await VerificationCode.countDocuments()).toBe(1);
    });
  });
});
