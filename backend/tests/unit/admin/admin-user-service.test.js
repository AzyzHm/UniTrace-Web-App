import { describe, expect, it, vi } from 'vitest';
import { createAdminUserService } from '../../../src/services/admin/admin-user.service.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../src/exceptions/app-error.js';

const ADMIN = { _id: 'admin-1', role: 'admin' };
const FIXED = new Date('2026-11-16T12:00:00Z');

const build = ({
  target = { _id: 'user-7', role: 'user', deletedAt: null },
  anonymized = { _id: 'user-7' },
  leftoverError = null,
} = {}) => {
  const adminUserRepository = {
    findPage: vi.fn(async () => ({ items: [], total: 0 })),
  };
  const userRepository = {
    findById: vi.fn(async () => target),
    anonymize: vi.fn(async () => anonymized),
  };
  const refreshTokenRepository = { deleteAllForUser: vi.fn(async () => {}) };
  const verificationCodeRepository = { deleteAllForUser: vi.fn(async () => {}) };
  if (leftoverError) refreshTokenRepository.deleteAllForUser.mockRejectedValue(leftoverError);
  const eventBus = { emit: vi.fn(async () => {}) };
  const auditService = { record: vi.fn(async () => ({})) };
  const logger = { error: vi.fn() };

  const service = createAdminUserService({
    adminUserRepository,
    userRepository,
    refreshTokenRepository,
    verificationCodeRepository,
    eventBus,
    auditService,
    clock: () => FIXED,
    logger,
  });

  return {
    service,
    adminUserRepository,
    userRepository,
    refreshTokenRepository,
    verificationCodeRepository,
    eventBus,
    auditService,
    logger,
  };
};

describe('createAdminUserService', () => {
  it('refuses to be built without its dependencies', () => {
    expect(() => createAdminUserService({})).toThrow('is required');
  });

  describe('list', () => {
    it('asks the repository for the page that was requested', async () => {
      const { service, adminUserRepository } = build();

      const result = await service.list({ page: 3, limit: 10 });

      expect(adminUserRepository.findPage).toHaveBeenCalledWith({ skip: 20, limit: 10 });
      expect(result).toMatchObject({ page: 3, limit: 10, total: 0 });
    });
  });

  describe('deleteUser', () => {
    it('anonymizes the account with placeholders and the deletion date', async () => {
      const { service, userRepository } = build();

      await service.deleteUser(ADMIN, 'user-7', { reason: 'Spam account' });

      expect(userRepository.anonymize).toHaveBeenCalledWith('user-7', {
        username: 'deleted_user_user-7',
        email: 'deleted_user-7@deleted.invalid',
        deletedAt: FIXED,
      });
    });

    it('emits user.deleted with the id and the deletion date', async () => {
      const { service, eventBus } = build();

      await service.deleteUser(ADMIN, 'user-7', { reason: 'Spam account' });

      expect(eventBus.emit).toHaveBeenCalledWith(EVENTS_USER_DELETED, {
        userId: 'user-7',
        deletedAt: FIXED,
      });
    });

    it('revokes the refresh tokens and the pending codes', async () => {
      const { service, refreshTokenRepository, verificationCodeRepository } = build();

      await service.deleteUser(ADMIN, 'user-7', { reason: 'Spam account' });

      expect(refreshTokenRepository.deleteAllForUser).toHaveBeenCalledWith('user-7');
      expect(verificationCodeRepository.deleteAllForUser).toHaveBeenCalledWith('user-7');
    });

    it('writes an audit line with the trimmed reason', async () => {
      const { service, auditService } = build();

      await service.deleteUser(ADMIN, 'user-7', { reason: '  Spam account  ' });

      expect(auditService.record).toHaveBeenCalledWith({
        actor: ADMIN,
        action: 'user.deleted',
        targetType: 'user',
        targetId: 'user-7',
        reason: 'Spam account',
      });
    });

    it('answers 404 for an unknown user', async () => {
      const { service } = build({ target: null });

      await expect(service.deleteUser(ADMIN, 'missing', { reason: 'Spam' })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('answers 404 for a user that is already deleted', async () => {
      const { service, userRepository } = build({
        target: { _id: 'user-7', role: 'user', deletedAt: FIXED },
      });

      await expect(service.deleteUser(ADMIN, 'user-7', { reason: 'Spam' })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(userRepository.anonymize).not.toHaveBeenCalled();
    });

    it('refuses to delete the admin own account with a 409', async () => {
      const { service, userRepository } = build({
        target: { _id: 'admin-1', role: 'admin', deletedAt: null },
      });

      await expect(service.deleteUser(ADMIN, 'admin-1', { reason: 'Spam' })).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(userRepository.anonymize).not.toHaveBeenCalled();
    });

    it('refuses to delete another admin with a 409', async () => {
      const { service, userRepository } = build({
        target: { _id: 'admin-2', role: 'admin', deletedAt: null },
      });

      await expect(service.deleteUser(ADMIN, 'admin-2', { reason: 'Spam' })).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(userRepository.anonymize).not.toHaveBeenCalled();
    });

    it('refuses a missing reason with a 400 and changes nothing', async () => {
      const { service, userRepository, eventBus, auditService } = build();

      await expect(service.deleteUser(ADMIN, 'user-7', {})).rejects.toBeInstanceOf(ValidationError);
      expect(userRepository.anonymize).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('answers 404 when a parallel deletion already anonymized the account', async () => {
      const { service, eventBus, auditService } = build({ anonymized: null });

      await expect(service.deleteUser(ADMIN, 'user-7', { reason: 'Spam' })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('logs a failed cleanup instead of failing the deletion', async () => {
      const { service, logger } = build({ leftoverError: new Error('db down') });

      await expect(
        service.deleteUser(ADMIN, 'user-7', { reason: 'Spam' }),
      ).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledOnce();
    });
  });
});

// Kept as a literal so the test also checks the contract name used by the other binomes.
const EVENTS_USER_DELETED = 'user.deleted';
