import { createAdminUserRepository } from '../repositories/admin/user-admin.repository.js';
import { createAuditLogRepository } from '../repositories/admin/audit-log.repository.js';
import { createAdminUserService } from '../services/admin/admin-user.service.js';
import { createAuditService } from '../services/admin/audit.service.js';

export function buildAdmin({ common, auth, use }) {
  const { clock, eventBus, userRepository } = common;
  const { refreshTokenRepository, verificationCodeRepository } = auth;

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

  return { services: { auditService, adminUserService } };
}
