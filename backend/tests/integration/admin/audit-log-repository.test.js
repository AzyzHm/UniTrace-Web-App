import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuditLogRepository } from '../../../src/repositories/admin/audit-log.repository.js';
import { AuditLog } from '../../../src/models/admin/audit-log.model.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

describe('audit log repository', () => {
  const repo = createAuditLogRepository();
  const admin = new mongoose.Types.ObjectId();
  const target = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await connectTestDb();
    await AuditLog.init();
  });

  afterAll(disconnectTestDb);

  beforeEach(clearTestDb);

  it('returns the history of one target, newest first', async () => {
    const older = new Date('2026-11-10T10:00:00Z');
    const newer = new Date('2026-11-12T10:00:00Z');

    await repo.create({
      actor: admin,
      action: 'declaration.hidden',
      targetType: 'declaration',
      targetId: target,
      createdAt: older,
    });
    await repo.create({
      actor: admin,
      action: 'declaration.restored',
      targetType: 'declaration',
      targetId: target,
      createdAt: newer,
    });

    const history = await repo.findByTarget(target, { limit: 10 });

    expect(history.map((line) => line.action)).toEqual([
      'declaration.restored',
      'declaration.hidden',
    ]);
  });

  it('does not mix the history of different targets', async () => {
    const other = new mongoose.Types.ObjectId();

    await repo.create({
      actor: admin,
      action: 'declaration.hidden',
      targetType: 'declaration',
      targetId: other,
    });

    expect(await repo.findByTarget(target, { limit: 10 })).toEqual([]);
  });

  it('respects the limit', async () => {
    for (let i = 0; i < 3; i += 1) {
      await repo.create({
        actor: admin,
        action: 'declaration.hidden',
        targetType: 'declaration',
        targetId: target,
      });
    }

    expect(await repo.findByTarget(target, { limit: 2 })).toHaveLength(2);
  });
});
