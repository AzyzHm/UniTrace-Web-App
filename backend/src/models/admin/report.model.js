import mongoose from 'mongoose';
import { REPORT_REASON_VALUES } from '../../constants/admin/report-reasons.js';
import {
  DEFAULT_REPORT_STATUS,
  REPORT_STATUS_VALUES,
} from '../../constants/admin/report-status.js';

const reportSchema = new mongoose.Schema(
  {
    declaration: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Declaration',
      required: true,
    },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      enum: REPORT_REASON_VALUES,
      required: true,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    status: {
      type: String,
      enum: REPORT_STATUS_VALUES,
      default: DEFAULT_REPORT_STATUS,
    },
    treatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    treatedAt: {
      type: Date,
      default: null,
    },
    resolution: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
  },
  { timestamps: true },
);

// A user can have only one open report per declaration. Treated reports do not block a new one.
reportSchema.index(
  { declaration: 1, reporter: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
);

// Admin queue: open reports, newest first.
reportSchema.index({ status: 1, createdAt: -1 });

export const Report = mongoose.model('Report', reportSchema);
