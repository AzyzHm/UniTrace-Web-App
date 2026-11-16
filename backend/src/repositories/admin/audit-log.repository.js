import { AuditLog } from '../../models/admin/audit-log.model.js';

export function createAuditLogRepository({ model = AuditLog } = {}) {
  return {
    create(data) {
      return model.create(data);
    },

    // Newest first, so the admin sees the latest decision at the top of a history.
    findByTarget(targetId, { limit }) {
      return model.find({ targetId }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
    },
  };
}
