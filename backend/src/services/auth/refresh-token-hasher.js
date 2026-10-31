import { createHash, randomBytes } from 'node:crypto';

// 32 random bytes cannot be guessed, so a fast unkeyed SHA-256 is enough. Only the hash is
// stored: a database leak does not give usable tokens.
const TOKEN_BYTES = 32;

export function createRefreshTokenHasher({ random = randomBytes } = {}) {
  return {
    generate() {
      return random(TOKEN_BYTES).toString('base64url');
    },

    hash(token) {
      return createHash('sha256').update(token).digest('hex');
    },
  };
}
