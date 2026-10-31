import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VerificationCode } from '../../../src/models/auth/verification-code.model.js';
import { createVerificationCodeRepository } from '../../../src/repositories/auth/verification-code.repository.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const MINUTE = 60_000;
const COOLDOWN = 2 * MINUTE;

const newId = () => new mongoose.Types.ObjectId();
const inMinutes = (n) => new Date(Date.now() + n * MINUTE);

function buildCode(overrides = {}) {
  return {
    user: newId(),
    purpose: 'email_verification',
    codeHash: 'hash-1',
    expiresAt: inMinutes(10),
    ...overrides,
  };
}

describe('VerificationCode model', () => {
  beforeAll(async () => {
    await connectTestDb();
    await VerificationCode.init();
  });

  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  it('applies defaults', async () => {
    const code = await VerificationCode.create(buildCode());

    expect(code.attempts).toBe(0);
    expect(code.lastSentAt).toBeInstanceOf(Date);
  });

  it('requires user, purpose, codeHash and expiresAt', async () => {
    await expect(VerificationCode.create({})).rejects.toMatchObject({
      name: 'ValidationError',
      errors: {
        user: expect.anything(),
        purpose: expect.anything(),
        codeHash: expect.anything(),
        expiresAt: expect.anything(),
      },
    });
  });

  it('rejects a purpose outside the enum', async () => {
    await expect(
      VerificationCode.create(buildCode({ purpose: 'newsletter' })),
    ).rejects.toMatchObject({
      name: 'ValidationError',
    });
  });

  it('allows only one code per user and purpose', async () => {
    const user = newId();
    await VerificationCode.create(buildCode({ user }));

    await expect(VerificationCode.create(buildCode({ user }))).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('allows one code per purpose for the same user', async () => {
    const user = newId();
    await VerificationCode.create(buildCode({ user, purpose: 'email_verification' }));
    await VerificationCode.create(buildCode({ user, purpose: 'password_reset' }));

    expect(await VerificationCode.countDocuments({ user })).toBe(2);
  });

  it('has a TTL index on expiresAt', async () => {
    const indexes = await VerificationCode.collection.indexes();
    const ttl = indexes.find((index) => index.key.expiresAt === 1);

    expect(ttl.expireAfterSeconds).toBe(0);
  });
});

describe('verification code repository', () => {
  const repo = createVerificationCodeRepository();

  beforeAll(async () => {
    await connectTestDb();
    await VerificationCode.init();
  });

  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  function replace(userId, overrides = {}) {
    return repo.replaceCode({
      userId,
      purpose: 'email_verification',
      codeHash: 'hash-new',
      expiresAt: inMinutes(10),
      sentAt: new Date(),
      cooldownMs: COOLDOWN,
      ...overrides,
    });
  }

  describe('replaceCode', () => {
    it('creates the first code with zero attempts', async () => {
      const userId = newId();

      const code = await replace(userId);

      expect(code.codeHash).toBe('hash-new');
      expect(code.attempts).toBe(0);
      expect(await VerificationCode.countDocuments({ user: userId })).toBe(1);
    });

    it('replaces an old code and resets the attempts', async () => {
      const user = newId();
      await VerificationCode.create(
        buildCode({ user, codeHash: 'hash-old', attempts: 3, lastSentAt: inMinutes(-3) }),
      );

      const code = await replace(user);

      expect(code.codeHash).toBe('hash-new');
      expect(code.attempts).toBe(0);
      expect(await VerificationCode.countDocuments({ user })).toBe(1);
    });

    it('returns null and changes nothing during the cooldown', async () => {
      const user = newId();
      await VerificationCode.create(
        buildCode({ user, codeHash: 'hash-old', attempts: 2, lastSentAt: inMinutes(-1) }),
      );

      const code = await replace(user);

      expect(code).toBeNull();
      const stored = await VerificationCode.findOne({ user });
      expect(stored.codeHash).toBe('hash-old');
      expect(stored.attempts).toBe(2);
    });

    it('lets only one of several simultaneous sends through', async () => {
      const user = newId();

      const results = await Promise.all(Array.from({ length: 5 }, () => replace(user)));

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await VerificationCode.countDocuments({ user })).toBe(1);
    });

    it('keeps the cooldown separate per purpose', async () => {
      const user = newId();
      await replace(user, { purpose: 'email_verification' });

      const reset = await replace(user, { purpose: 'password_reset' });

      expect(reset).not.toBeNull();
    });
  });

  describe('findByUserAndPurpose', () => {
    it('finds the stored code, or null', async () => {
      const user = newId();
      await VerificationCode.create(buildCode({ user }));

      expect(
        await repo.findByUserAndPurpose({ userId: user, purpose: 'email_verification' }),
      ).not.toBeNull();
      expect(
        await repo.findByUserAndPurpose({ userId: user, purpose: 'password_reset' }),
      ).toBeNull();
    });
  });

  describe('consumeAttempt', () => {
    const consume = (userId) =>
      repo.consumeAttempt({ userId, purpose: 'email_verification', maxAttempts: 5 });

    it('increments the counter and returns the document with its hash', async () => {
      const user = newId();
      await VerificationCode.create(buildCode({ user, codeHash: 'hash-1' }));

      const code = await consume(user);

      expect(code.attempts).toBe(1);
      expect(code.codeHash).toBe('hash-1');
    });

    it('returns null once the attempts are used up', async () => {
      const user = newId();
      await VerificationCode.create(buildCode({ user, attempts: 5 }));

      expect(await consume(user)).toBeNull();
      expect((await VerificationCode.findOne({ user })).attempts).toBe(5);
    });

    it('returns null when there is no code', async () => {
      expect(await consume(newId())).toBeNull();
    });

    it('never allows more than the limit, even in parallel', async () => {
      const user = newId();
      await VerificationCode.create(buildCode({ user }));

      const results = await Promise.all(Array.from({ length: 10 }, () => consume(user)));

      expect(results.filter(Boolean)).toHaveLength(5);
      expect((await VerificationCode.findOne({ user })).attempts).toBe(5);
    });
  });

  describe('delete', () => {
    it('removes one code and reports whether it existed', async () => {
      const user = newId();
      await VerificationCode.create(buildCode({ user }));

      expect(await repo.delete({ userId: user, purpose: 'email_verification' })).toBe(true);
      expect(await repo.delete({ userId: user, purpose: 'email_verification' })).toBe(false);
    });

    it('deleteAllForUser removes every purpose for that user only', async () => {
      const user = newId();
      const other = newId();
      await VerificationCode.create(buildCode({ user, purpose: 'email_verification' }));
      await VerificationCode.create(buildCode({ user, purpose: 'password_reset' }));
      await VerificationCode.create(buildCode({ user: other }));

      await repo.deleteAllForUser(user);

      expect(await VerificationCode.countDocuments({ user })).toBe(0);
      expect(await VerificationCode.countDocuments({ user: other })).toBe(1);
    });
  });
});
