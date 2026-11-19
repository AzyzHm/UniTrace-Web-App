import { createAdminUserRepository } from '../repositories/admin/user-admin.repository.js';
import { createAuditLogRepository } from '../repositories/admin/audit-log.repository.js';
import { createReportRepository } from '../repositories/admin/report.repository.js';
import { createAdminUserService } from '../services/admin/admin-user.service.js';
import { createAuditService } from '../services/admin/audit.service.js';
import { createModerationService } from '../services/admin/moderation.service.js';
import { createReportService } from '../services/admin/report.service.js';

export function buildAdmin({ common, auth, declarations, use }) {
  const { clock, eventBus, userRepository } = common;
  const { refreshTokenRepository, verificationCodeRepository } = auth;
  const { declarationRepository } = declarations;
  const { declarationService } = declarations.services;

  const auditLogRepository = use('auditLogRepository', createAuditLogRepository);
  const auditService = use('auditService', () => createAuditService({ auditLogRepository, clock }));

  const adminUserRepository = use('adminUserRepository', createAdminUserRepository);
  const adminUserService = use('adminUserService', () =>
    createAdminUserService({
      adminUserRepository,
      userRepository,
      refreshTokenRepository,
      verificationCodeRepository,
      eventBus,
      auditService,
      clock,
    }),
  );

  const reportRepository = use('reportRepository', createReportRepository);
  const reportService = use('reportService', () =>
    createReportService({
      reportRepository,
      declarationRepository,
      auditService,
      eventBus,
      clock,
    }),
  );

  const moderationService = use('moderationService', () =>
    createModerationService({ declarationService, declarationRepository, auditService }),
  );

  return { services: { auditService, adminUserService, reportService, moderationService } };
}
