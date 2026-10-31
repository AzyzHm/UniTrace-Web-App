import bcrypt from 'bcrypt';

export function createPasswordHasher({ cost = 12 } = {}) {
  return {
    hash: (plain) => bcrypt.hash(plain, cost),
    compare: (plain, hash) => bcrypt.compare(plain, hash),
  };
}
