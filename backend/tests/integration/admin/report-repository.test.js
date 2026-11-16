import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createReportRepository } from '../../../src/repositories/admin/report.repository.js';
import { Report } from '../../../src/models/admin/report.model.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

describe('report repository', () => {
  const repo = createReportRepository();
  const declaration = new mongoose.Types.ObjectId();
  const reporter = new mongoose.Types.ObjectId();
  const admin = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await connectTestDb();
    await Report.init();
  });

  afterAll(disconnectTestDb);

  beforeEach(clearTestDb);

  const open = (overrides = {}) =>
    repo.create({ declaration, reporter, reason: 'duplicate', ...overrides });

  it('finds the open report of one user on one declaration', async () => {
    const created = await open();

    const found = await repo.findOpenBy(declaration, reporter);

    expect(String(found._id)).toBe(String(created._id));
  });

  it('ignores a report that is already treated', async () => {
    const report = await open();
    await repo.markTreated(report._id, {
      status: 'treated',
      resolution: 'Done',
      treatedBy: admin,
      treatedAt: new Date(),
    });

    expect(await repo.findOpenBy(declaration, reporter)).toBeNull();
  });

  it('lists open reports oldest first, with a total', async () => {
    const first = await open({ createdAt: new Date('2026-11-01T00:00:00Z') });
    const second = await open({
      reporter: new mongoose.Types.ObjectId(),
      createdAt: new Date('2026-11-05T00:00:00Z'),
    });

    const page = await repo.findPageByStatus('open', { skip: 0, limit: 10 });

    expect(page.total).toBe(2);
    expect(page.items.map((r) => String(r._id))).toEqual([String(first._id), String(second._id)]);
  });

  it('does not overwrite a report that was already treated', async () => {
    const report = await open();
    await repo.markTreated(report._id, {
      status: 'treated',
      resolution: 'first',
      treatedBy: admin,
      treatedAt: new Date(),
    });

    const again = await repo.markTreated(report._id, {
      status: 'dismissed',
      resolution: 'second',
      treatedBy: admin,
      treatedAt: new Date(),
    });

    expect(again).toBeNull();
    const stored = await Report.findById(report._id).lean();
    expect(stored.resolution).toBe('first');
  });
});
