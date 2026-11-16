import { EVENTS } from '../../constants/common/events.js';
import { REPORT_STATUSES } from '../../constants/admin/report-status.js';
import { AUDIT_ACTIONS } from '../../constants/admin/audit-actions.js';
import { DECLARATION_STATUSES } from '../../constants/declarations/declaration-status.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../exceptions/app-error.js';

export function createReportService({
  reportRepository,
  declarationRepository,
  auditService,
  eventBus,
  clock = () => new Date(),
}) {
  if (!reportRepository || !declarationRepository || !auditService || !eventBus) {
    throw new Error(
      'createReportService(): reportRepository, declarationRepository, auditService and eventBus are required',
    );
  }

  return {
    // A user flags a declaration. Own declarations and deleted ones cannot be reported, and a
    // user can have only one open report per declaration.
    async create(user, declarationId, { reason, comment = null }) {
      const declaration = await declarationRepository.findById(declarationId);
      if (!declaration || declaration.status === DECLARATION_STATUSES.DELETED) {
        throw new NotFoundError('Declaration not found');
      }
      if (String(declaration.owner) === String(user._id)) {
        throw new ForbiddenError('You cannot report your own declaration');
      }

      const duplicate = await reportRepository.findOpenBy(declarationId, user._id);
      if (duplicate) {
        throw new ConflictError('You already reported this declaration');
      }

      const report = await reportRepository.create({
        declaration: declarationId,
        reporter: user._id,
        reason,
        comment,
      });

      await eventBus.emit(EVENTS.REPORT_CREATED, {
        reportId: String(report._id),
        declarationId: String(declarationId),
      });

      return report;
    },

    // Admin queue: open reports, oldest first, so the first reports in are handled first.
    listOpen({ page, limit }) {
      return reportRepository.findPageByStatus(REPORT_STATUSES.OPEN, {
        skip: (page - 1) * limit,
        limit,
      });
    },

    // An admin closes a report, either as treated (action taken) or dismissed (no problem).
    async treat(admin, reportId, { status, resolution = null }) {
      const report = await reportRepository.findById(reportId);
      if (!report) throw new NotFoundError('Report not found');
      if (report.status !== REPORT_STATUSES.OPEN) {
        throw new ConflictError('Report already treated');
      }

      const updated = await reportRepository.markTreated(reportId, {
        status,
        resolution,
        treatedBy: admin._id,
        treatedAt: clock(),
      });

      await auditService.record({
        actor: admin,
        action: AUDIT_ACTIONS.REPORT_TREATED,
        targetType: 'report',
        targetId: reportId,
        reason: resolution,
        metadata: { status },
      });

      await eventBus.emit(EVENTS.REPORT_TREATED, {
        reportId: String(reportId),
        declarationId: String(report.declaration),
        status,
      });

      return updated;
    },
  };
}
