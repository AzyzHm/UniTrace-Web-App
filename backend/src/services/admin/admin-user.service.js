import { AUDIT_ACTIONS } from '../../constants/admin/audit-actions.js';
import { EVENTS } from '../../constants/common/events.js';
import { isAdminRole } from '../../constants/common/roles.js';
import { ConflictError, NotFoundError, ValidationError } from '../../exceptions/app-error.js';

const silentLogger = { error() {} };
const MIN_REASON_LENGTH = 3;

export function createAdminUserService({
  adminUserRepository,
  userRepository,
  refreshTokenRepository,
  verificationCodeRepository,
  eventBus,
  auditService,
  clock = () => new Date(),
  logger = silentLogger,
}) {
  const dependencies = {
    adminUserRepository,
    userRepository,
    refreshTokenRepository,
    verificationCodeRepository,
    eventBus,
    auditService,
  };
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (!dependency) {
      throw new Error(`createAdminUserService(): ${name} is required`);
    }
  }

  function requireReason(input) {
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < MIN_REASON_LENGTH) {
      throw new ValidationError('Invalid input', [
        { field: 'reason', message: `reason must be at least ${MIN_REASON_LENGTH} characters` },
      ]);
    }
    return reason;
  }

  // Runs after the account is anonymized, so a failure is logged instead of failing a deletion
  // that already happened.
  async function removeLeftovers(userId) {
    const results = await Promise.allSettled([
      refreshTokenRepository.deleteAllForUser(userId),
      verificationCodeRepository.deleteAllForUser(userId),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error(
          { err: result.reason, userId: String(userId) },
          'Cleanup after admin account deletion failed',
        );
      }
    }
  }

  return {
    async list({ page, limit }) {
      const { items, total } = await adminUserRepository.findPage({
        skip: (page - 1) * limit,
        limit,
      });
      return { items, page, limit, total };
    },

    // Admin deletion: same anonymization as a self-deletion, without the password check.
    // The declarations are cleaned by the user.deleted listener, not here.
    async deleteUser(admin, targetId, input) {
      const reason = requireReason(input);

      const target = await userRepository.findById(targetId);
      if (!target || target.deletedAt) throw new NotFoundError('User not found');
      if (String(target._id) === String(admin._id)) {
        throw new ConflictError('An admin cannot delete their own account');
      }
      if (isAdminRole(target.role)) {
        throw new ConflictError('An admin account cannot be deleted from here');
      }

      const id = String(target._id);
      const deletedAt = clock();
      const anonymized = await userRepository.anonymize(target._id, {
        username: `deleted_user_${id}`,
        email: `deleted_${id}@deleted.invalid`,
        deletedAt,
      });
      // null means a parallel deletion already anonymized this account.
      if (!anonymized) throw new NotFoundError('User not found');

      await eventBus.emit(EVENTS.USER_DELETED, { userId: id, deletedAt });
      await removeLeftovers(target._id);

      await auditService.record({
        actor: admin,
        action: AUDIT_ACTIONS.USER_DELETED,
        targetType: 'user',
        targetId: target._id,
        reason,
      });
    },
  };
}
