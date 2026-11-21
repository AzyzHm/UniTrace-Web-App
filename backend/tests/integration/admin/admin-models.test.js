import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../../../src/models/admin/audit-log.model.js';
import { Report } from '../../../src/models/admin/report.model.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const declarationId = new mongoose.Types.ObjectId();
const reporterId = new mongoose.Types.ObjectId();
const adminId = new mongoose.Types.ObjectId();
const targetId = new mongoose.Types.ObjectId();

const reportInput = (overrides = {}) => ({
  declaration: declarationId,
  reporter: reporterId,
  reason: 'duplicate',
  ...overrides,
});

describe('Report model', () => {
  beforeAll(async () => {
    await connectTestDb();
    await Report.init();
    await AuditLog.init();
  });

  afterAll(disconnectTestDb);

  beforeEach(clearTestDb);

  it('defaults to an open report with no treatment yet', async () => {
    const report = await Report.create(reportInput());

    expect(report.status).toBe('open');
    expect(report.treatedBy).toBeNull();
    expect(report.treatedAt).toBeNull();
    expect(report.comment).toBeNull();
  });

  it('refuses a reason that is not in the list', async () => {
    await expect(Report.create(reportInput({ reason: 'spam' }))).rejects.toThrow();
  });

  it('refuses a second open report from the same user on the same declaration', async () => {
    await Report.create(reportInput());

    await expect(Report.create(reportInput({ reason: 'other' }))).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('allows a new report once the previous one is treated', async () => {
    await Report.create(reportInput({ status: 'treated' }));

    await expect(Report.create(reportInput())).resolves.toBeTruthy();
  });

  it('trims and caps the comment at 500 characters', async () => {
    const report = await Report.create(reportInput({ comment: '  hello  ' }));
    expect(report.comment).toBe('hello');

    await expect(
      Report.create(
        reportInput({ reporter: new mongoose.Types.ObjectId(), comment: 'x'.repeat(501) }),
      ),
    ).rejects.toThrow();
  });
});

describe('AuditLog model', () => {
  beforeAll(async () => {
    await connectTestDb();
    await AuditLog.init();
  });

  afterAll(disconnectTestDb);

  beforeEach(clearTestDb);

  const entry = (overrides = {}) => ({
    actor: adminId,
    action: 'user.deleted',
    targetType: 'user',
    targetId,
    reason: 'Spam',
    ...overrides,
  });

  it('stores the actor, action, target and reason', async () => {
    const line = await AuditLog.create(entry());

    expect(String(line.actor)).toBe(String(adminId));
    expect(line.action).toBe('user.deleted');
    expect(line.targetType).toBe('user');
    expect(line.reason).toBe('Spam');
  });

  it('has a createdAt but no updatedAt', async () => {
    const line = await AuditLog.create(entry());

    expect(line.createdAt).toBeInstanceOf(Date);
    expect(line.updatedAt).toBeUndefined();
  });

  it('refuses an action that is not in the audit list', async () => {
    await expect(AuditLog.create(entry({ action: 'user.suspended' }))).rejects.toThrow();
  });

  it('refuses an unknown target type', async () => {
    await expect(AuditLog.create(entry({ targetType: 'comment' }))).rejects.toThrow();
  });
});
