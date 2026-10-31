import { describe, expect, it, vi } from 'vitest';
import { createRefreshTokenHasher } from '../../../src/services/auth/refresh-token-hasher.js';

describe('refresh token hasher', () => {
  const hasher = createRefreshTokenHasher();

  it('generates a 256 bit token as 43 URL-safe characters', () => {
    expect(hasher.generate()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never generates the same token twice', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => hasher.generate()));

    expect(tokens.size).toBe(100);
  });

  it('hashes to 64 hex characters, the same every time for the same token', () => {
    const hash = hasher.hash('some-token');

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hasher.hash('some-token')).toBe(hash);
  });

  it('gives another hash for another token, and never contains the token', () => {
    const hash = hasher.hash('some-token');

    expect(hasher.hash('other-token')).not.toBe(hash);
    expect(hash).not.toContain('some-token');
  });

  it('uses the injected random source', () => {
    const random = vi.fn().mockReturnValue(Buffer.alloc(32, 1));

    createRefreshTokenHasher({ random }).generate();

    expect(random).toHaveBeenCalledWith(32);
  });
});
