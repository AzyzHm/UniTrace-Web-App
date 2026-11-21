import { describe, expect, it, vi } from 'vitest';
import { createReportService } from '../../../src/services/admin/report.service.js';
import { EVENTS } from '../../../src/constants/common/events.js';

const OWNER = 'owner-1';
const REPORTER = 'reporter-1';
const ADMIN = { _id: 'admin-1' };
const DECL = 'decl-1';

const build = (overrides = {}) => {
  const reportRepository = {
    create: vi.fn(async (data) => ({ _id: 'report-1', ...data })),
    findOpenBy: vi.fn(async () => null),
    findById: vi.fn(async () => ({ _id: 'report-1', status: 'open', declaration: DECL })),
    findPageByStatus: vi.fn(async () => ({ items: [], total: 0 })),
    markTreated: vi.fn(async (id, changes) => ({ _id: id, ...changes })),
    ...overrides.reportRepository,
  };
  const declarationRepository = {
    findById: vi.fn(async () => ({ _id: DECL, owner: OWNER, status: 'pending' })),
    ...overrides.declarationRepository,
  };
  const auditService = { record: vi.fn(async () => ({})) };
  const emitted = [];
  const eventBus = { emit: vi.fn(async (name, payload) => emitted.push({ name, payload })) };
  const service = createReportService({
    reportRepository,
    declarationRepository,
    auditService,
    eventBus,
    clock: () => new Date('2026-11-16T12:00:00Z'),
  });
  return { service, reportRepository, auditService, eventBus, emitted };
};

describe('createReportService', () => {
  it('refuses to be built without its dependencies', () => {
    expect(() => createReportService({})).toThrow('are required');
  });

  describe('create', () => {
    it('stores a report and emits report.created', async () => {
      const { service, reportRepository, emitted } = build();

      const report = await service.create({ _id: REPORTER }, DECL, {
        reason: 'duplicate',
        comment: 'Same bag posted twice',
      });

      expect(report.reason).toBe('duplicate');
      expect(reportRepository.create).toHaveBeenCalledWith({
        declaration: DECL,
        reporter: REPORTER,
        reason: 'duplicate',
        comment: 'Same bag posted twice',
      });
      expect(emitted[0].name).toBe(EVENTS.REPORT_CREATED);
    });

    it('answers 404 for an unknown declaration', async () => {
      const { service } = build({
        declarationRepository: { findById: vi.fn(async () => null) },
      });

      await expect(
        service.create({ _id: REPORTER }, DECL, { reason: 'other' }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('answers 404 for a deleted declaration', async () => {
      const { service } = build({
        declarationRepository: {
          findById: vi.fn(async () => ({ _id: DECL, owner: OWNER, status: 'deleted' })),
        },
      });

      await expect(
        service.create({ _id: REPORTER }, DECL, { reason: 'other' }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('refuses to report your own declaration with a 403', async () => {
      const { service, reportRepository } = build();

      await expect(service.create({ _id: OWNER }, DECL, { reason: 'other' })).rejects.toMatchObject(
        { statusCode: 403 },
      );
      expect(reportRepository.create).not.toHaveBeenCalled();
    });

    it('refuses a second open report from the same user with a 409', async () => {
      const { service, reportRepository } = build({
        reportRepository: {
          findOpenBy: vi.fn(async () => ({ _id: 'existing' })),
        },
      });

      await expect(
        service.create({ _id: REPORTER }, DECL, { reason: 'other' }),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(reportRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('treat', () => {
    it('closes an open report, writes an audit line and emits report.treated', async () => {
      const { service, reportRepository, auditService, emitted } = build();

      await service.treat(ADMIN, 'report-1', {
        status: 'treated',
        resolution: 'Declaration removed',
      });

      expect(reportRepository.markTreated).toHaveBeenCalledWith('report-1', {
        status: 'treated',
        resolution: 'Declaration removed',
        treatedBy: 'admin-1',
        treatedAt: new Date('2026-11-16T12:00:00Z'),
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: ADMIN,
          action: 'report.treated',
          targetType: 'report',
          targetId: 'report-1',
        }),
      );
      expect(emitted.at(-1).name).toBe(EVENTS.REPORT_TREATED);
    });

    it('can dismiss a report', async () => {
      const { service, reportRepository } = build();

      await service.treat(ADMIN, 'report-1', { status: 'dismissed' });

      expect(reportRepository.markTreated.mock.calls[0][1].status).toBe('dismissed');
    });

    it('answers 404 for an unknown report', async () => {
      const { service } = build({
        reportRepository: { findById: vi.fn(async () => null) },
      });

      await expect(service.treat(ADMIN, 'missing', { status: 'treated' })).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('refuses to treat a report that is already closed, with a 409', async () => {
      const { service, reportRepository } = build({
        reportRepository: {
          findById: vi.fn(async () => ({ _id: 'report-1', status: 'treated' })),
        },
      });

      await expect(service.treat(ADMIN, 'report-1', { status: 'dismissed' })).rejects.toMatchObject(
        { statusCode: 409 },
      );
      expect(reportRepository.markTreated).not.toHaveBeenCalled();
    });
  });

  describe('listOpen', () => {
    it('asks the repository for open reports with the right page', async () => {
      const { service, reportRepository } = build();

      await service.listOpen({ page: 3, limit: 10 });

      expect(reportRepository.findPageByStatus).toHaveBeenCalledWith('open', {
        skip: 20,
        limit: 10,
      });
    });
  });
});
