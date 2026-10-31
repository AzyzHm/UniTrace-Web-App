import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CODE_MAX_ATTEMPTS,
  CODE_RESEND_COOLDOWN_MS,
  CODE_TTL_MS,
} from '../../../src/constants/auth/verification-code.js';
import { InvalidCodeError, RateLimitedError } from '../../../src/exceptions/app-error.js';
import { VerificationCode } from '../../../src/models/auth/verification-code.model.js';
import { createVerificationCodeRepository } from '../../../src/repositories/auth/verification-code.repository.js';
import { createCodeHasher } from '../../../src/services/auth/code-hasher.js';
import { createVerificationCodeService } from '../../../src/services/auth/verification-code.service.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const VERIFY = 'email_verification';
const RESET = 'password_reset';
const EMAIL = 'sara@isamm.uma.tn';

const newId = () => new mongoose.Types.ObjectId();
const wrongCode = (code) => (code === '000000' ? '000001' : '000000');

function setup() {
  let now = Date.now();
  const emailService = {
    sendVerificationCode: vi.fn().mockResolvedValue(undefined),
    sendPasswordResetCode: vi.fn().mockResolvedValue(undefined),
  };
  const service = createVerificationCodeService({
    codeRepository: createVerificationCodeRepository(),
    codeHasher: createCodeHasher({ secret: 'a'.repeat(32) }),
    emailService,
    clock: () => new Date(now),
  });

  return {
    service,
    emailService,
    advance: (ms) => {
      now += ms;
    },
    lastSentCode: (method = 'sendVerificationCode') => {
      const calls = emailService[method].mock.calls;
      return calls[calls.length - 1][1];
    },
  };
}

describe('verification code service', () => {
  beforeAll(async () => {
    await connectTestDb();
    await VerificationCode.init();
  });

  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  describe('issue', () => {
    it('emails a 6 digit code and stores only its hash', async () => {
      const { service, emailService, lastSentCode } = setup();
      const userId = newId();

      await service.issue({ userId, email: EMAIL, purpose: VERIFY });

      expect(emailService.sendVerificationCode).toHaveBeenCalledWith(
        EMAIL,
        expect.stringMatching(/^\d{6}$/),
      );
      const stored = await VerificationCode.findOne({ user: userId });
      expect(stored.codeHash).not.toContain(lastSentCode());
      expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + CODE_TTL_MS - 5000);
    });

    it('uses the reset email for a password reset code', async () => {
      const { service, emailService } = setup();

      await service.issue({ userId: newId(), email: EMAIL, purpose: RESET });

      expect(emailService.sendPasswordResetCode).toHaveBeenCalledTimes(1);
      expect(emailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('refuses an unknown purpose and stores nothing', async () => {
      const { service } = setup();

      await expect(
        service.issue({ userId: newId(), email: EMAIL, purpose: 'newsletter' }),
      ).rejects.toThrow(/purpose/);
      expect(await VerificationCode.countDocuments()).toBe(0);
    });

    it('refuses a second code during the cooldown and says how long to wait', async () => {
      const { service, emailService, advance } = setup();
      const userId = newId();
      await service.issue({ userId, email: EMAIL, purpose: VERIFY });
      advance(60_000);

      const error = await service.issue({ userId, email: EMAIL, purpose: VERIFY }).catch((e) => e);

      expect(error).toBeInstanceOf(RateLimitedError);
      expect(error.retryAfterSeconds).toBe(60);
      expect(emailService.sendVerificationCode).toHaveBeenCalledTimes(1);
    });

    it('sends a new code after the cooldown, and the old one stops working', async () => {
      const { service, advance, lastSentCode } = setup();
      const userId = newId();
      await service.issue({ userId, email: EMAIL, purpose: VERIFY });
      const oldCode = lastSentCode();
      advance(CODE_RESEND_COOLDOWN_MS);

      await service.issue({ userId, email: EMAIL, purpose: VERIFY });
      const newCode = lastSentCode();

      expect(await VerificationCode.countDocuments({ user: userId })).toBe(1);
      if (newCode !== oldCode) {
        await expect(
          service.verify({ userId, purpose: VERIFY, code: oldCode }),
        ).rejects.toBeInstanceOf(InvalidCodeError);
      }
      await expect(
        service.verify({ userId, purpose: VERIFY, code: newCode }),
      ).resolves.toBeUndefined();
    });

    it('removes the code and rethrows when the email cannot be sent, so the user can retry at once', async () => {
      const { service, emailService } = setup();
      const userId = newId();
      emailService.sendVerificationCode.mockRejectedValueOnce(new Error('provider down'));

      await expect(service.issue({ userId, email: EMAIL, purpose: VERIFY })).rejects.toThrow(
        'provider down',
      );
      expect(await VerificationCode.countDocuments({ user: userId })).toBe(0);

      await expect(
        service.issue({ userId, email: EMAIL, purpose: VERIFY }),
      ).resolves.toBeUndefined();
    });
  });

  describe('verify', () => {
    it('accepts the right code', async () => {
      const { service, lastSentCode } = setup();
      const userId = newId();
      await service.issue({ userId, email: EMAIL, purpose: VERIFY });

      await expect(
        service.verify({ userId, purpose: VERIFY, code: lastSentCode() }),
      ).resolves.toBeUndefined();
    });

    it('can be used only once', async () => {
      const { service, lastSentCode } = setup();
      const userId = newId();
      await service.issue({ userId, email: EMAIL, purpose: VERIFY });
      const code = lastSentCode();
      await service.verify({ userId, purpose: VERIFY, code });

      await expect(service.verify({ userId, purpose: VERIFY, code })).rejects.toBeInstanceOf(
        InvalidCodeError,
      );
    });

    it('rejects a wrong code', async () => {
      const { service, lastSentCode } = setup();
      const userId = newId();
      await service.issue({ userId, email: EMAIL, purpose: VERIFY });

      await expect(
        service.verify({ userId, purpose: VERIFY, code: wrongCode(lastSentCode()) }),
      ).rejects.toBeInstanceOf(InvalidCodeError);
    });

    it('locks the code after too many wrong attempts, even for the right code', async () => {
      const { service, lastSentCode } = setup();
      const userId = newId();
      await service.issue({ userId, email: EMAIL, purpose: VERIFY });
      const code = lastSentCode();

      for (let i = 0; i < CODE_MAX_ATTEMPTS; i += 1) {
        await expect(
          service.verify({ userId, purpose: VERIFY, code: wrongCode(code) }),
        ).rejects.toBeInstanceOf(InvalidCodeError);
      }

      await expect(service.verify({ userId, purpose: VERIFY, code })).rejects.toBeInstanceOf(
        InvalidCodeError,
      );
    });

    it('rejects an expired code and removes it', async () => {
      const { service, advance, lastSentCode } = setup();
      const userId = newId();
      await service.issue({ userId, email: EMAIL, purpose: VERIFY });
      const code = lastSentCode();
      advance(CODE_TTL_MS + 1000);

      await expect(service.verify({ userId, purpose: VERIFY, code })).rejects.toBeInstanceOf(
        InvalidCodeError,
      );
      expect(await VerificationCode.countDocuments({ user: userId })).toBe(0);
    });

    it('rejects when no code was ever issued', async () => {
      const { service } = setup();

      await expect(
        service.verify({ userId: newId(), purpose: VERIFY, code: '123456' }),
      ).rejects.toBeInstanceOf(InvalidCodeError);
    });

    it('does not accept a verification code for a password reset', async () => {
      const { service, lastSentCode } = setup();
      const userId = newId();
      await service.issue({ userId, email: EMAIL, purpose: VERIFY });

      await expect(
        service.verify({ userId, purpose: RESET, code: lastSentCode() }),
      ).rejects.toBeInstanceOf(InvalidCodeError);
    });

    it('lets exactly one of several simultaneous requests use the right code', async () => {
      const { service, lastSentCode } = setup();
      const userId = newId();
      await service.issue({ userId, email: EMAIL, purpose: VERIFY });
      const code = lastSentCode();

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => service.verify({ userId, purpose: VERIFY, code })),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4);
    });
  });
});
