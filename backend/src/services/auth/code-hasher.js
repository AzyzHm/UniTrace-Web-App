import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { CODE_LENGTH } from '../../constants/auth/verification-code.js';

// A 6-digit code has only a million values: a plain hash could be reversed instantly
// from a leaked database, so the hash is keyed with a server secret (HMAC).
const CODE_SPACE = 10 ** CODE_LENGTH;

export function createCodeHasher({ secret, random = randomInt }) {
  if (!secret) {
    throw new Error('createCodeHasher(): secret is required');
  }

  // userId and purpose are part of the hashed value, so a code cannot be replayed
  // for another user or another purpose.
  function hash(code, { userId, purpose }) {
    return createHmac('sha256', secret).update(`${userId}:${purpose}:${code}`).digest('hex');
  }

  return {
    generate() {
      return String(random(CODE_SPACE)).padStart(CODE_LENGTH, '0');
    },

    hash,

    matches(code, storedHash, context) {
      // timingSafeEqual throws when the lengths differ, hence the length check.
      const expected = Buffer.from(storedHash, 'hex');
      const actual = Buffer.from(hash(code, context), 'hex');

      return expected.length === actual.length && timingSafeEqual(expected, actual);
    },
  };
}
