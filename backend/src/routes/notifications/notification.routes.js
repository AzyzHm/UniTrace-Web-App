import { Router } from 'express';
import { validate } from '../../middlewares/common/validate.js';

export function createNotificationRoutes({
  notificationController,
  requireAuth,
  notificationIdParamsSchema,
  listNotificationsQuerySchema,
}) {
  const router = Router();

  router.use(requireAuth);

  router.get('/', validate(listNotificationsQuerySchema, 'query'), notificationController.list);
  // Literal path above '/:id/read'.
  router.post('/read-all', notificationController.markAllRead);
  router.patch(
    '/:id/read',
    validate(notificationIdParamsSchema, 'params'),
    notificationController.markRead,
  );

  return router;
}
