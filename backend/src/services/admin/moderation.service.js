import { AUDIT_ACTIONS } from '../../constants/admin/audit-actions.js';
import { DECLARATION_STATUSES } from '../../constants/declarations/declaration-status.js';
import { ConflictError, NotFoundError, ValidationError } from '../../exceptions/app-error.js';

const MIN_REASON_LENGTH = 3;

// Admin moderation of declarations. The status rules stay in the declaration service (transition
// table). This service adds what moderation needs: a reason and one audit line per action.
export function createModerationService({
  declarationService,
  declarationRepository,
  auditService,
}) {
  if (!declarationService || !declarationRepository || !auditService) {
    throw new Error(
      'createModerationService(): declarationService, declarationRepository and auditService are required',
    );
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

  // The status change goes first. The audit line is written only if it succeeded.
  async function apply(admin, id, { target, action, reason }) {
    const updated = await declarationService.changeStatusByAdmin(id, target, { reason });
    await auditService.record({
      actor: admin,
      action,
      targetType: 'declaration',
      targetId: id,
      reason,
      metadata: { status: target },
    });
    return updated;
  }

  return {
    async hide(admin, id, input) {
      return apply(admin, id, {
        target: DECLARATION_STATUSES.HIDDEN,
        action: AUDIT_ACTIONS.DECLARATION_HIDDEN,
        reason: requireReason(input),
      });
    },

    async delete(admin, id, input) {
      return apply(admin, id, {
        target: DECLARATION_STATUSES.DELETED,
        action: AUDIT_ACTIONS.DECLARATION_DELETED,
        reason: requireReason(input),
      });
    },

    // Restore goes back to the status the declaration had before hiding, never anywhere else.
    async restore(admin, id, input) {
      const reason = requireReason(input);
      const found = await declarationRepository.findById(id);
      if (!found || found.status === DECLARATION_STATUSES.DELETED) {
        throw new NotFoundError('Declaration not found');
      }
      if (found.status !== DECLARATION_STATUSES.HIDDEN) {
        throw new ConflictError('Only a hidden declaration can be restored');
      }
      if (!found.statusBeforeHidden) {
        throw new ConflictError(
          'The status before hiding is unknown, the declaration cannot be restored',
        );
      }
      return apply(admin, id, {
        target: found.statusBeforeHidden,
        action: AUDIT_ACTIONS.DECLARATION_RESTORED,
        reason,
      });
    },
  };
}
