import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RefreshToken } from '../../../src/models/auth/refresh-token.model.js';
import { createRefreshTokenRepository } from '../../../src/repositories/auth/refresh-token.repository.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const newId = () => new mongoose.Types.ObjectId();
const inFuture = (ms = 60_000) => new Date(Date.now() + ms);

describe('refresh token repository', () => {
  const repository = createRefreshTokenRepository();

  beforeAll(async () => {
    await connectTestDb();
    await RefreshToken.init();
  });

  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  it('creates a token and finds it by its hash', async () => {
    const userId = newId();
    await repository.create({ userId, tokenHash: 'hash-1', expiresAt: inFuture() });

    const found = await repository.findByHash('hash-1');

    expect(String(found.user)).toBe(String(userId));
    expect(found.usedAt).toBeNull();
  });

  it('returns null for an unknown hash', async () => {
    expect(await repository.findByHash('nope')).toBeNull();
  });

  it('refuses two tokens with the same hash', async () => {
    await repository.create({ userId: newId(), tokenHash: 'same', expiresAt: inFuture() });

    await expect(
      repository.create({ userId: newId(), tokenHash: 'same', expiresAt: inFuture() }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  describe('claim', () => {
    it('marks the token used and returns it', async () => {
      await repository.create({ userId: newId(), tokenHash: 'h', expiresAt: inFuture() });
      const now = new Date();

      const claimed = await repository.claim({ tokenHash: 'h', now });

      expect(claimed.usedAt.getTime()).toBe(now.getTime());
    });

    it('works only once for the same token', async () => {
      await repository.create({ userId: newId(), tokenHash: 'h', expiresAt: inFuture() });
      await repository.claim({ tokenHash: 'h', now: new Date() });

      expect(await repository.claim({ tokenHash: 'h', now: new Date() })).toBeNull();
    });

    it('refuses an expired token', async () => {
      await repository.create({ userId: newId(), tokenHash: 'h', expiresAt: inFuture(-1000) });

      expect(await repository.claim({ tokenHash: 'h', now: new Date() })).toBeNull();
    });

    it('refuses an unknown token', async () => {
      expect(await repository.claim({ tokenHash: 'nope', now: new Date() })).toBeNull();
    });

    it('lets exactly one of several simultaneous claims win', async () => {
      await repository.create({ userId: newId(), tokenHash: 'h', expiresAt: inFuture() });

      const results = await Promise.all(
        Array.from({ length: 5 }, () => repository.claim({ tokenHash: 'h', now: new Date() })),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  describe('deleteByHash', () => {
    it('deletes one token and says whether it existed', async () => {
      await repository.create({ userId: newId(), tokenHash: 'a', expiresAt: inFuture() });
      await repository.create({ userId: newId(), tokenHash: 'b', expiresAt: inFuture() });

      expect(await repository.deleteByHash('a')).toBe(true);
      expect(await repository.deleteByHash('a')).toBe(false);
      expect(await repository.findByHash('b')).not.toBeNull();
    });
  });

  describe('deleteAllForUser', () => {
    it('deletes every token of that user and no one else', async () => {
      const sara = newId();
      const omar = newId();
      await repository.create({ userId: sara, tokenHash: 's1', expiresAt: inFuture() });
      await repository.create({ userId: sara, tokenHash: 's2', expiresAt: inFuture() });
      await repository.create({ userId: omar, tokenHash: 'o1', expiresAt: inFuture() });

      await repository.deleteAllForUser(sara);

      expect(await RefreshToken.countDocuments({ user: sara })).toBe(0);
      expect(await RefreshToken.countDocuments({ user: omar })).toBe(1);
    });
  });
});
