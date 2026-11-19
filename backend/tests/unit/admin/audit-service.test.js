import { describe, expect, it, vi } from 'vitest';
import { createAuditService } from '../../../src/services/admin/audit.service.js';

const fixedDate = new Date('2026-11-16T10:00:00Z');

const build = () => {
  const auditLogRepository = {
    create: vi.fn(async (data) => data),
    findByTarget: vi.fn(async () => []),
  };
  const service = createAuditService({
    auditLogRepository,
    clock: () => fixedDate,
  });
  return { service, auditLogRepository };
};

describe('createAuditService', () => {
  it('refuses to be built without a repository', () => {
    expect(() => createAuditService({})).toThrow('auditLogRepository is required');
  });

  it('stores the actor id, action, target, reason and the clock time', async () => {
    const { service, auditLogRepository } = build();
    const admin = { _id: 'admin-1' };

    await service.record({
      actor: admin,
      action: 'user.deleted',
      targetType: 'user',
      targetId: 'user-7',
      reason: 'Repeated spam',
    });

    expect(auditLogRepository.create).toHaveBeenCalledWith({
      actor: 'admin-1',
      action: 'user.deleted',
      targetType: 'user',
      targetId: 'user-7',
      reason: 'Repeated spam',
      metadata: null,
      createdAt: fixedDate,
    });
  });

  it('accepts a plain actor id as well as a user object', async () => {
    const { service, auditLogRepository } = build();

    await service.record({
      actor: 'admin-2',
      action: 'report.treated',
      targetType: 'report',
      targetId: 'report-1',
    });

    expect(auditLogRepository.create.mock.calls[0][0].actor).toBe('admin-2');
  });

  it('defaults the reason and metadata to null', async () => {
    const { service, auditLogRepository } = build();

    await service.record({
      actor: { _id: 'admin-1' },
      action: 'declaration.hidden',
      targetType: 'declaration',
      targetId: 'decl-3',
    });

    const stored = auditLogRepository.create.mock.calls[0][0];
    expect(stored.reason).toBeNull();
    expect(stored.metadata).toBeNull();
  });

  it('passes the limit to the repository when listing a target history', async () => {
    const { service, auditLogRepository } = build();

    await service.listForTarget('decl-3', { limit: 10 });

    expect(auditLogRepository.findByTarget).toHaveBeenCalledWith('decl-3', { limit: 10 });
  });

  it('uses a limit of 50 when none is given', async () => {
    const { service, auditLogRepository } = build();

    await service.listForTarget('decl-3');

    expect(auditLogRepository.findByTarget).toHaveBeenCalledWith('decl-3', { limit: 50 });
  });
});
