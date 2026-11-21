import { describe, expect, it, vi } from 'vitest';
import { createStatsService } from '../../../src/services/admin/stats.service.js';
import { ValidationError } from '../../../src/exceptions/app-error.js';

const NOW = new Date('2026-11-19T00:00:00Z');

const build = ({ declarationRows = [], reportRows = [], dayRows = [] } = {}) => {
  const statsRepository = {
    countActiveUsers: vi.fn(async () => 4),
    declarationsByTypeAndStatus: vi.fn(async () => declarationRows),
    reportsByStatus: vi.fn(async () => reportRows),
    declarationsPerDay: vi.fn(async () => dayRows),
  };
  const service = createStatsService({ statsRepository, clock: () => NOW });
  return { service, statsRepository };
};

describe('createStatsService', () => {
  it('refuses to be built without a repository', () => {
    expect(() => createStatsService({})).toThrow('statsRepository is required');
  });

  it('uses the last 30 days when no range is given', async () => {
    const { service } = build();

    const result = await service.dashboard({});

    expect(result.range.to).toEqual(NOW);
    expect(result.range.from).toEqual(new Date('2026-10-20T00:00:00Z'));
  });

  it('refuses a range where from is after to', async () => {
    const { service } = build();

    await expect(
      service.dashboard({ from: new Date('2026-11-10'), to: new Date('2026-11-01') }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a range longer than 366 days', async () => {
    const { service } = build();

    await expect(
      service.dashboard({ from: new Date('2025-01-01'), to: new Date('2026-11-19') }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('summarizes declarations by type and status, and reads matches and recovered from them', async () => {
    const { service } = build({
      declarationRows: [
        { _id: { type: 'lost', status: 'pending' }, count: 2 },
        { _id: { type: 'found', status: 'matched' }, count: 1 },
        { _id: { type: 'found', status: 'resolved' }, count: 3 },
      ],
    });

    const { declarations } = await service.dashboard({});

    expect(declarations.total).toBe(6);
    expect(declarations.byType).toEqual({ lost: 2, found: 4 });
    expect(declarations.byStatus.pending).toBe(2);
    expect(declarations.byStatus.hidden).toBe(0);
    expect(declarations.matches).toBe(1);
    expect(declarations.recovered).toBe(3);
  });

  it('shows every report status, with zeros for the missing ones', async () => {
    const { service } = build({
      reportRows: [{ _id: 'open', count: 2 }],
    });

    const { reports } = await service.dashboard({});

    expect(reports.total).toBe(2);
    expect(reports.byStatus).toEqual({ open: 2, treated: 0, dismissed: 0 });
  });

  it('turns the daily rows into a timeline', async () => {
    const { service } = build({
      dayRows: [{ _id: '2026-11-05', count: 2 }],
    });

    const { timeline } = await service.dashboard({});

    expect(timeline).toEqual([{ date: '2026-11-05', created: 2 }]);
  });

  it('gives the totals all time and only filters the timeline by range', async () => {
    const { service, statsRepository } = build();
    const from = new Date('2026-11-01T00:00:00Z');
    const to = new Date('2026-11-10T00:00:00Z');

    await service.dashboard({ from, to });

    expect(statsRepository.declarationsPerDay).toHaveBeenCalledWith({ from, to });
    expect(statsRepository.declarationsByTypeAndStatus).toHaveBeenCalledWith();
  });
});
