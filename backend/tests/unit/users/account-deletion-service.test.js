import { describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../../src/constants/common/events.js';
import { UnauthenticatedError, ValidationError } from '../../../src/exceptions/app-error.js';
import { createAccountDeletionService } from '../../../src/services/users/account-deletion.service.js';

const USER = { _id: '507f1f77bcf86cd799439011' };
const INPUT = { password: 'Secret123' };
const NOW = new Date('2026-10-20T10:00:00Z');

function setup({
  stored = { ...USER, password: 'stored-hash' },
  matches = true,
  anonymized = USER,
  deleteTokens,
  deleteCodes,
} = {}) {
  const calls = [];
  const track = (name, result) =>
    vi.fn(async () => {
      calls.push(name);
      return result;
    });

  const userRepository = {
    findByIdWithPassword: track('findByIdWithPassword', stored),
    anonymize: track('anonymize', anonymized),
  };
  const passwordHasher = { compare: track('compare', matches) };
  const refreshTokenRepository = {
    deleteAllForUser: deleteTokens ?? track('deleteTokens', undefined),
  };
  const verificationCodeRepository = {
    deleteAllForUser: deleteCodes ?? track('deleteCodes', undefined),
  };
  const eventBus = { emit: track('emit', undefined) };
  const logger = { error: vi.fn() };
  const service = createAccountDeletionService({
    userRepository,
    passwordHasher,
    refreshTokenRepository,
    verificationCodeRepository,
    eventBus,
    clock: () => NOW,
    logger,
  });

  return {
    service,
    calls,
    logger,
    userRepository,
    passwordHasher,
    refreshTokenRepository,
    verificationCodeRepository,
    eventBus,
  };
}

describe('account deletion service', () => {
  it('requires its dependencies', () => {
    expect(() => createAccountDeletionService({})).toThrow(/required/);
  });

  it('checks the password against the stored hash first', async () => {
    const { service, userRepository, passwordHasher } = setup();

    await service.deleteAccount(USER, INPUT);

    expect(userRepository.findByIdWithPassword).toHaveBeenCalledWith(USER._id);
    expect(passwordHasher.compare).toHaveBeenCalledWith('Secret123', 'stored-hash');
  });

  it('replaces the username and the email with placeholders that contain the id', async () => {
    const { service, userRepository } = setup();

    await service.deleteAccount(USER, INPUT);

    expect(userRepository.anonymize).toHaveBeenCalledWith(USER._id, {
      username: 'deleted_user_507f1f77bcf86cd799439011',
      email: 'deleted_507f1f77bcf86cd799439011@deleted.invalid',
      deletedAt: NOW,
    });
  });

  it('announces the deletion right after the change, then removes the leftovers', async () => {
    const { service, calls } = setup();

    await service.deleteAccount(USER, INPUT);

    expect(calls.slice(0, 4)).toEqual(['findByIdWithPassword', 'compare', 'anonymize', 'emit']);
    expect(calls.slice(4).sort()).toEqual(['deleteCodes', 'deleteTokens']);
  });

  it('emits user.deleted with the id as a string and the deletion time', async () => {
    const { service, eventBus } = setup();

    await service.deleteAccount(USER, INPUT);

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith(EVENTS.USER_DELETED, {
      userId: '507f1f77bcf86cd799439011',
      deletedAt: NOW,
    });
  });

  it('ends every session and removes every pending code of the user', async () => {
    const { service, refreshTokenRepository, verificationCodeRepository } = setup();

    await service.deleteAccount(USER, INPUT);

    expect(refreshTokenRepository.deleteAllForUser).toHaveBeenCalledWith(USER._id);
    expect(verificationCodeRepository.deleteAllForUser).toHaveBeenCalledWith(USER._id);
  });

  it('refuses a wrong password with a 400 on that field, and changes nothing', async () => {
    const { service, userRepository, eventBus, refreshTokenRepository } = setup({
      matches: false,
    });

    const error = await service.deleteAccount(USER, INPUT).catch((err) => err);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.statusCode).toBe(400);
    expect(error.details).toEqual([{ field: 'password', message: 'Password is incorrect' }]);
    expect(userRepository.anonymize).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(refreshTokenRepository.deleteAllForUser).not.toHaveBeenCalled();
  });

  it('answers 401 when the user no longer exists, before any hashing', async () => {
    const { service, passwordHasher } = setup({ stored: null });

    await expect(service.deleteAccount(USER, INPUT)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(passwordHasher.compare).not.toHaveBeenCalled();
  });

  it('answers 401 and sends no event when a parallel request deleted the account first', async () => {
    const { service, eventBus, refreshTokenRepository } = setup({ anonymized: null });

    await expect(service.deleteAccount(USER, INPUT)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(refreshTokenRepository.deleteAllForUser).not.toHaveBeenCalled();
  });

  it('still succeeds, and logs, when a cleanup step fails after the deletion', async () => {
    const failure = new Error('database hiccup');
    const { service, logger, eventBus, verificationCodeRepository } = setup({
      deleteTokens: vi.fn().mockRejectedValue(failure),
    });

    await expect(service.deleteAccount(USER, INPUT)).resolves.toBeUndefined();

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    expect(verificationCodeRepository.deleteAllForUser).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0].err).toBe(failure);
  });
});
