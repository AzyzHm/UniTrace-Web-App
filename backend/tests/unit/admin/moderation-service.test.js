import { describe, expect, it, vi } from 'vitest';
import { createModerationService } from '../../../src/services/admin/moderation.service.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../src/exceptions/app-error.js';

const ADMIN = { _id: 'admin-1' };

const build = ({
  declaration = { _id: 'decl-1', status: 'pending', statusBeforeHidden: null },
  changeError = null,
} = {}) => {
  const declarationService = {
    changeStatusByAdmin: vi.fn(async (id, target) => {
      if (changeError) throw changeError;
      return { _id: id, status: target };
    }),
  };
  const declarationRepository = { findById: vi.fn(async () => declaration) };
  const auditService = { record: vi.fn(async () => ({})) };
  const service = createModerationService({
    declarationService,
    declarationRepository,
    auditService,
  });
  return { service, declarationService, auditService };
};

describe('createModerationService', () => {
  it('refuses to be built without its dependencies', () => {
    expect(() => createModerationService({})).toThrow('are required');
  });

  it('hides a declaration and records the audit line', async () => {
    const { service, declarationService, auditService } = build();

    await service.hide(ADMIN, 'decl-1', { reason: 'Looks like a fake listing' });

    expect(declarationService.changeStatusByAdmin).toHaveBeenCalledWith('decl-1', 'hidden', {
      reason: 'Looks like a fake listing',
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'declaration.hidden', targetType: 'declaration' }),
    );
  });

  it('trims the reason before using it', async () => {
    const { service, declarationService } = build();

    await service.hide(ADMIN, 'decl-1', { reason: '  Duplicate post  ' });

    expect(declarationService.changeStatusByAdmin.mock.calls[0][2]).toEqual({
      reason: 'Duplicate post',
    });
  });

  it('deletes a declaration and records the audit line', async () => {
    const { service, declarationService, auditService } = build();

    await service.delete(ADMIN, 'decl-1', { reason: 'Offensive content' });

    expect(declarationService.changeStatusByAdmin.mock.calls[0][1]).toBe('deleted');
    expect(auditService.record.mock.calls[0][0].action).toBe('declaration.deleted');
  });

  it('restores to the status the declaration had before hiding', async () => {
    const { service, declarationService, auditService } = build({
      declaration: { _id: 'decl-1', status: 'hidden', statusBeforeHidden: 'matched' },
    });

    await service.restore(ADMIN, 'decl-1', { reason: 'Reviewed, fine' });

    expect(declarationService.changeStatusByAdmin.mock.calls[0][1]).toBe('matched');
    expect(auditService.record.mock.calls[0][0].action).toBe('declaration.restored');
  });

  it('answers 404 when restoring an unknown declaration', async () => {
    const { service } = build({ declaration: null });

    await expect(service.restore(ADMIN, 'missing', { reason: 'Reviewed' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('answers 409 when restoring a declaration that is not hidden', async () => {
    const { service } = build({
      declaration: { _id: 'decl-1', status: 'pending', statusBeforeHidden: null },
    });

    await expect(service.restore(ADMIN, 'decl-1', { reason: 'Reviewed' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('answers 409 when the previous status is unknown', async () => {
    const { service } = build({
      declaration: { _id: 'decl-1', status: 'hidden', statusBeforeHidden: null },
    });

    await expect(service.restore(ADMIN, 'decl-1', { reason: 'Reviewed' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('refuses a missing reason with a 400 and changes nothing', async () => {
    const { service, declarationService, auditService } = build();

    await expect(service.hide(ADMIN, 'decl-1', {})).rejects.toBeInstanceOf(ValidationError);
    expect(declarationService.changeStatusByAdmin).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('refuses a reason shorter than 3 characters after trimming', async () => {
    const { service, declarationService } = build();

    await expect(service.delete(ADMIN, 'decl-1', { reason: '  ab ' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(declarationService.changeStatusByAdmin).not.toHaveBeenCalled();
  });

  it('writes no audit line when the status change fails', async () => {
    const { service, auditService } = build({ changeError: new ConflictError('nope') });

    await expect(service.hide(ADMIN, 'decl-1', { reason: 'Spam' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(auditService.record).not.toHaveBeenCalled();
  });
});
