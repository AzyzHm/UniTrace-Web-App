import { describe, expect, it } from 'vitest';
import { createPasswordHasher } from '../../../src/services/auth/password-hasher.js';

const hasher = createPasswordHasher({ cost: 4 });

describe('password hasher', () => {
  it('never returns the plain password', async () => {
    const hash = await hasher.hash('Secret123');

    expect(hash).not.toContain('Secret123');
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
  });

  it('accepts the right password and refuses a wrong one', async () => {
    const hash = await hasher.hash('Secret123');

    expect(await hasher.compare('Secret123', hash)).toBe(true);
    expect(await hasher.compare('Wrong123', hash)).toBe(false);
  });

  it('salts every hash, so equal passwords give different hashes', async () => {
    const first = await hasher.hash('Secret123');
    const second = await hasher.hash('Secret123');

    expect(first).not.toBe(second);
  });
});
