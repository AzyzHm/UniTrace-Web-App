// Writes one audit line per admin action. Every moderation service calls it, so no action can
// skip the history.
export function createAuditService({ auditLogRepository, clock = () => new Date() }) {
  if (!auditLogRepository) {
    throw new Error('createAuditService(): auditLogRepository is required');
  }

  return {
    record({ actor, action, targetType, targetId, reason = null, metadata = null }) {
      return auditLogRepository.create({
        actor: actor._id ?? actor,
        action,
        targetType,
        targetId,
        reason,
        metadata,
        createdAt: clock(),
      });
    },

    listForTarget(targetId, { limit = 50 } = {}) {
      return auditLogRepository.findByTarget(targetId, { limit });
    },
  };
}
