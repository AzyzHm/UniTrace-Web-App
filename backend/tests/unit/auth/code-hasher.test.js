import { describe, expect, it } from 'vitest';
import { createCodeHasher } from '../../../src/services/auth/code-hasher.js';

const SECRET = 'a'.repeat(32);
const CONTEXT = { userId: '507f1f77bcf86cd799439011', purpose: 'email_verification' };

describe('code hasher', () => {
  const hasher = createCodeHasher({ secret: SECRET });

  describe('generate', () => {
    it('always returns exactly 6 digits', () => {
      for (let i = 0; i < 500; i += 1) {
        expect(hasher.generate()).toMatch(/^\d{6}$/);
      }
    });

    it('keeps leading zeros', () => {
      const fixed = createCodeHasher({ secret: SECRET, random: () => 42 });

      expect(fixed.generate()).toBe('000042');
    });

    it('draws from the full range, 000000 to 999999', () => {
      const calls = [];
      const spy = createCodeHasher({
        secret: SECRET,
        random: (max) => {
          calls.push(max);
          return 0;
        },
      });

      spy.generate();

      expect(calls).toEqual([1_000_000]);
    });
  });

  describe('hash and matches', () => {
    it('is deterministic', () => {
      expect(hasher.hash('123456', CONTEXT)).toBe(hasher.hash('123456', CONTEXT));
    });

    it('never contains the plain code', () => {
      expect(hasher.hash('123456', CONTEXT)).not.toContain('123456');
    });

    it('matches the right code and refuses a wrong one', () => {
      const stored = hasher.hash('123456', CONTEXT);

      expect(hasher.matches('123456', stored, CONTEXT)).toBe(true);
      expect(hasher.matches('654321', stored, CONTEXT)).toBe(false);
    });

    it('does not match for another user', () => {
      const stored = hasher.hash('123456', CONTEXT);
      const other = { ...CONTEXT, userId: '507f1f77bcf86cd799439012' };

      expect(hasher.matches('123456', stored, other)).toBe(false);
    });

    it('does not match for another purpose', () => {
      const stored = hasher.hash('123456', CONTEXT);
      const other = { ...CONTEXT, purpose: 'password_reset' };

      expect(hasher.matches('123456', stored, other)).toBe(false);
    });

    it('produces different hashes with a different secret', () => {
      const other = createCodeHasher({ secret: 'b'.repeat(32) });

      expect(other.hash('123456', CONTEXT)).not.toBe(hasher.hash('123456', CONTEXT));
    });

    it('treats a malformed stored hash as a mismatch instead of throwing', () => {
      expect(hasher.matches('123456', 'not-a-hash', CONTEXT)).toBe(false);
      expect(hasher.matches('123456', '', CONTEXT)).toBe(false);
    });
  });

  it('refuses to start without a secret', () => {
    expect(() => createCodeHasher({})).toThrow(/secret/);
  });
});
