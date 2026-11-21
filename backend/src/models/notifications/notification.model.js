import mongoose from 'mongoose';
import { NOTIFICATION_TYPE_VALUES } from '../../constants/notifications/notification.js';

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPE_VALUES, required: true },
    message: { type: String, required: true, maxlength: 300 },
    correspondence: { type: mongoose.Schema.Types.ObjectId, ref: 'Correspondence' },
    read: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

export const Notification = mongoose.model('Notification', notificationSchema);
