import { toNotificationResponse } from '../../presenters/matching/correspondence.presenter.js';

export function createNotificationController({ notificationService }) {
  if (!notificationService) throw new Error('createNotificationController(): notificationService is required');

  return {
    async list(req, res) {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const unreadOnly = req.query.unreadOnly === true || req.query.unreadOnly === 'true';
      const result = await notificationService.listMine(req.user, { page, limit, unreadOnly });
      res.status(200).json({ ...result, items: result.items.map(toNotificationResponse) });
    },

    async markRead(req, res) {
      const n = await notificationService.markRead(req.user, req.params.id);
      res.status(200).json({ notification: toNotificationResponse(n) });
    },

    async markAllRead(req, res) {
      await notificationService.markAllRead(req.user);
      res.status(204).end();
    },
  };
}