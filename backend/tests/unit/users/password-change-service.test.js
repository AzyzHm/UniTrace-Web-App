import { describe, expect, it, vi } from 'vitest';
import { REFRESH_TOKEN_TTL_MS } from '../../../src/constants/auth/refresh-token.js';
import { UnauthenticatedError, ValidationError } from '../../../src/exceptions/app-error.js';
import { createPasswordChangeService } from '../../../src/services/users/password-change.service.js';

const USER = { _id: '507f1f77bcf86cd799439011' };
const INPUT = { currentPassword: 'Secret123', newPassword: 'Brandnew456' };
const NOW = new Date('2026-10-20T10:00:00Z');

function setup({
  stored = { ...USER, password: 'old-hash' },
  matches = true,
  updated = USER,
} = {}) {
  const calls = [];
  const track = (name, result) =>
    vi.fn(async (...args) => {
      calls.push(name);
      return typeof result === 'function' ? result(...args) : result;
    });

  const userRepository = {
    findByIdWithPassword: track('findByIdWithPassword', stored),
    updatePassword: track('updatePassword', updated),
  };
  const passwordHasher = {
    compare: track('compare', matches),
    hash: track('hash', 'new-hash'),
  };
  const refreshTokenRepository = {
    deleteAllForUser: track('deleteAllForUser', undefined),
    create: track('create', undefined),
  };
  const refreshTokenHasher = {
    generate: vi.fn().mockReturnValue('plain-new-token'),
    hash: vi.fn().mockReturnValue('hashed-new-token'),
  };
  const service = createPasswordChangeService({
    userRepository,
    passwordHasher,
    refreshTokenRepository,
    refreshTokenHasher,
    clock: () => NOW,
  });

  return {
    service,
    calls,
    userRepository,
    passwordHasher,
    refreshTokenRepository,
    refreshTokenHasher,
  };
}

describe('password change service', () => {
  it('requires its dependencies', () => {
    expect(() => createPasswordChangeService({})).toThrow(/required/);
  });

  it('checks the current password against the stored hash, then stores the hash of the new one', async () => {
    const { service, userRepository, passwordHasher } = setup();

    await service.changePassword(USER, INPUT);

    expect(userRepository.findByIdWithPassword).toHaveBeenCalledWith(USER._id);
    expect(passwordHasher.compare).toHaveBeenCalledWith('Secret123', 'old-hash');
    expect(passwordHasher.hash).toHaveBeenCalledWith('Brandnew456');
    expect(userRepository.updatePassword).toHaveBeenCalledWith(USER._id, 'new-hash');
  });

  it('ends every session AFTER the password changed, then starts a new one', async () => {
    const { service, calls } = setup();

    await service.changePassword(USER, INPUT);

    expect(calls).toEqual([
      'findByIdWithPassword',
      'compare',
      'hash',
      'updatePassword',
      'deleteAllForUser',
      'create',
    ]);
  });

  it('stores only the hash of the new refresh token and returns the plain one', async () => {
    const { service, refreshTokenRepository } = setup();

    const result = await service.changePassword(USER, INPUT);

    expect(result).toEqual({ refreshToken: 'plain-new-token' });
    expect(refreshTokenRepository.deleteAllForUser).toHaveBeenCalledWith(USER._id);
    expect(refreshTokenRepository.create).toHaveBeenCalledWith({
      userId: USER._id,
      tokenHash: 'hashed-new-token',
      expiresAt: new Date(NOW.getTime() + REFRESH_TOKEN_TTL_MS),
    });
  });

  it('refuses a wrong current password with a 400 on that field, and changes nothing', async () => {
    const { service, passwordHasher, userRepository, refreshTokenRepository } = setup({
      matches: false,
    });

    const error = await service.changePassword(USER, INPUT).catch((err) => err);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.statusCode).toBe(400);
    expect(error.details).toEqual([
      { field: 'currentPassword', message: 'Current password is incorrect' },
    ]);
    expect(passwordHasher.hash).not.toHaveBeenCalled();
    expect(userRepository.updatePassword).not.toHaveBeenCalled();
    expect(refreshTokenRepository.deleteAllForUser).not.toHaveBeenCalled();
    expect(refreshTokenRepository.create).not.toHaveBeenCalled();
  });

  it('answers 401 when the user no longer exists, before any hashing', async () => {
    const { service, passwordHasher } = setup({ stored: null });

    await expect(service.changePassword(USER, INPUT)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(passwordHasher.compare).not.toHaveBeenCalled();
  });

  it('answers 401 and keeps the sessions when the user vanished during the update', async () => {
    const { service, refreshTokenRepository } = setup({ updated: null });

    await expect(service.changePassword(USER, INPUT)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(refreshTokenRepository.deleteAllForUser).not.toHaveBeenCalled();
  });
});
