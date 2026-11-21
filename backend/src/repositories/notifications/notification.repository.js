import { Notification } from '../../models/notifications/notification.model.js';

export function createNotificationRepository() {
  return {
    create: (data) => Notification.create(data),
    async findPageByUser(userId, { unreadOnly, skip, limit }) {
      const filter = { user: userId, ...(unreadOnly && { read: false }) };
      const [items, total, unread] = await Promise.all([
        Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Notification.countDocuments(filter),
        Notification.countDocuments({ user: userId, read: false }),
      ]);
      return { items, total, unread };
    },
    // The user is part of the filter: nobody can mark someone else's notification.
    markRead: (userId, id) =>
      Notification.findOneAndUpdate(
        { _id: id, user: userId },
        { read: true },
        { new: true },
      ).lean(),
    markAllRead: (userId) => Notification.updateMany({ user: userId, read: false }, { read: true }),
  };
}
