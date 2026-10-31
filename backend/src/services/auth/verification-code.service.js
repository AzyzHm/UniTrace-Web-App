import { CODE_PURPOSES } from '../../constants/auth/code-purposes.js';
import {
  CODE_MAX_ATTEMPTS,
  CODE_RESEND_COOLDOWN_MS,
  CODE_TTL_MS,
} from '../../constants/auth/verification-code.js';
import { InvalidCodeError, RateLimitedError } from '../../exceptions/app-error.js';

const EMAIL_METHOD_BY_PURPOSE = Object.freeze({
  [CODE_PURPOSES.EMAIL_VERIFICATION]: 'sendVerificationCode',
  [CODE_PURPOSES.PASSWORD_RESET]: 'sendPasswordResetCode',
});

export function createVerificationCodeService({
  codeRepository,
  codeHasher,
  emailService,
  clock = () => new Date(),
}) {
  function emailSenderFor(purpose) {
    const method = EMAIL_METHOD_BY_PURPOSE[purpose];
    if (!method) {
      throw new Error(`Unknown code purpose "${purpose}"`);
    }
    return (to, code) => emailService[method](to, code);
  }

  async function secondsUntilResend({ userId, purpose, now }) {
    const existing = await codeRepository.findByUserAndPurpose({ userId, purpose });
    if (!existing) return 1;

    const msLeft = existing.lastSentAt.getTime() + CODE_RESEND_COOLDOWN_MS - now.getTime();
    return Math.max(1, Math.ceil(msLeft / 1000));
  }

  async function issue({ userId, email, purpose }) {
    const send = emailSenderFor(purpose);

    const now = clock();
    const code = codeHasher.generate();

    // The cooldown is enforced inside this single database update, and the unique index on
    // (user, purpose) stops two first requests from both inserting. Null means too soon.
    const stored = await codeRepository.replaceCode({
      userId,
      purpose,
      codeHash: codeHasher.hash(code, { userId, purpose }),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      sentAt: now,
      cooldownMs: CODE_RESEND_COOLDOWN_MS,
    });

    if (!stored) {
      const retryAfterSeconds = await secondsUntilResend({ userId, purpose, now });
      throw new RateLimitedError('Please wait before requesting another code', {
        retryAfterSeconds,
      });
    }

    try {
      await send(email, code);
    } catch (err) {
      // The user never got this code: drop it so the cooldown does not block a retry.
      await codeRepository.delete({ userId, purpose });
      throw err;
    }
  }

  async function verify({ userId, purpose, code }) {
    // The attempt is counted before the comparison, atomically, so parallel guesses
    // cannot go past CODE_MAX_ATTEMPTS. Null means no attempts left (or no code).
    const stored = await codeRepository.consumeAttempt({
      userId,
      purpose,
      maxAttempts: CODE_MAX_ATTEMPTS,
    });
    if (!stored) throw new InvalidCodeError();

    // The TTL index removes expired codes with a delay, so expiry is checked here too.
    if (stored.expiresAt.getTime() <= clock().getTime()) {
      await codeRepository.delete({ userId, purpose });
      throw new InvalidCodeError();
    }

    if (!codeHasher.matches(code, stored.codeHash, { userId, purpose })) {
      throw new InvalidCodeError();
    }

    // Single use: if a parallel request already deleted the code, this one fails.
    const consumed = await codeRepository.delete({ userId, purpose });
    if (!consumed) throw new InvalidCodeError();
  }

  return { issue, verify };
}
