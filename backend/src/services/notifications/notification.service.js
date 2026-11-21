import { NotFoundError } from '../../exceptions/app-error.js';

export function createNotificationService({ notificationRepository, logger }) {
  if (!notificationRepository)
    throw new Error('createNotificationService(): notificationRepository is required');

  return {
    // Never breaks the caller: a failed notification is logged, not thrown.
    async notify(user, type, message, correspondence) {
      try {
        await notificationRepository.create({ user, type, message, correspondence });
      } catch (err) {
        logger?.error({ err, type }, 'Notification failed');
      }
    },

    async listMine(user, { page, limit, unreadOnly }) {
      const { items, total, unread } = await notificationRepository.findPageByUser(user._id, {
        unreadOnly,
        skip: (page - 1) * limit,
        limit,
      });
      return { items, page, limit, total, unread };
    },

    async markRead(user, id) {
      const updated = await notificationRepository.markRead(user._id, id);
      if (!updated) throw new NotFoundError('Notification not found');
      return updated;
    },

    markAllRead: (user) => notificationRepository.markAllRead(user._id),
  };
}
