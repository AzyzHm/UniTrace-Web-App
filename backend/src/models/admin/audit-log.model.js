import mongoose from 'mongoose';
import { AUDIT_ACTION_VALUES } from '../../constants/admin/audit-actions.js';

// Append-only: the code only creates these documents, never updates or deletes them.
const auditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action: {
      type: String,
      enum: AUDIT_ACTION_VALUES,
      required: true,
    },
    targetType: {
      type: String,
      enum: ['declaration', 'user', 'report'],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  // Only createdAt: an audit line never changes, so it has no updatedAt.
  { timestamps: { createdAt: true, updatedAt: false } },
);

// History of one target, newest first (declaration or user page).
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
// Global journal for the admin dashboard.
auditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
