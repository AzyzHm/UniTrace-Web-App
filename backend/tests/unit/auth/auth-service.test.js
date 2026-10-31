import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../../src/exceptions/app-error.js';
import { createAuthService } from '../../../src/services/auth/auth.service.js';

function setup() {
  const userRepository = { create: vi.fn(async (data) => ({ id: 'u1', ...data })) };
  const passwordHasher = { hash: vi.fn(async (plain) => `hashed:${plain}`) };
  const verificationCodeService = { issue: vi.fn().mockResolvedValue(undefined) };
  const service = createAuthService({ userRepository, passwordHasher, verificationCodeService });
  return { service, userRepository, passwordHasher, verificationCodeService };
}

const input = {
  username: 'sara.k',
  email: 'sara@isamm.uma.tn',
  phone: '+21612345678',
  password: 'Secret123',
};

describe('auth service, register', () => {
  it('stores the hash, never the plain password', async () => {
    const { service, userRepository } = setup();

    await service.register(input);

    const saved = userRepository.create.mock.calls[0][0];
    expect(saved.password).toBe('hashed:Secret123');
    expect(JSON.stringify(saved)).not.toContain('"Secret123"');
  });

  it('only passes whitelisted fields, so a role cannot slip through', async () => {
    const { service, userRepository } = setup();

    await service.register({ ...input, role: 'admin', isActive: false });

    expect(Object.keys(userRepository.create.mock.calls[0][0]).sort()).toEqual([
      'email',
      'password',
      'phone',
      'username',
    ]);
  });

  it('returns the created user', async () => {
    const { service } = setup();

    const user = await service.register(input);

    expect(user.id).toBe('u1');
    expect(user.email).toBe('sara@isamm.uma.tn');
  });

  it('lets a ConflictError from the repository reach the caller', async () => {
    const { service, userRepository } = setup();
    userRepository.create.mockRejectedValue(new ConflictError());

    await expect(service.register(input)).rejects.toBeInstanceOf(ConflictError);
  });
});
