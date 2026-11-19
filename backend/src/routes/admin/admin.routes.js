import { Router } from 'express';
import { requireAdmin } from '../../middlewares/admin/require-admin.js';
import { validate } from '../../middlewares/common/validate.js';

export function createAdminRoutes({ controllers, requireAuth, schemas }) {
  const router = Router();

  // Every route here needs a logged in admin. The role check runs before validation, so a
  // regular user learns nothing about the rules.
  router.use(requireAuth, requireAdmin);

  // Users
  router.get('/users', validate(schemas.listUsersQuery, 'query'), controllers.adminUser.list);
  router.delete(
    '/users/:id',
    validate(schemas.userIdParams, 'params'),
    validate(schemas.deleteUserBody),
    controllers.adminUser.remove,
  );

  // Reports
  router.get('/reports', validate(schemas.listReportsQuery, 'query'), controllers.report.list);
  router.patch(
    '/reports/:id',
    validate(schemas.reportIdParams, 'params'),
    validate(schemas.treatReportBody),
    controllers.report.treat,
  );

  // Declaration moderation
  router.post(
    '/declarations/:id/hide',
    validate(schemas.declarationIdParams, 'params'),
    validate(schemas.moderationBody),
    controllers.moderation.hide,
  );
  router.post(
    '/declarations/:id/restore',
    validate(schemas.declarationIdParams, 'params'),
    validate(schemas.moderationBody),
    controllers.moderation.restore,
  );
  router.delete(
    '/declarations/:id',
    validate(schemas.declarationIdParams, 'params'),
    validate(schemas.moderationBody),
    controllers.moderation.remove,
  );

  // Statistics
  router.get('/stats', validate(schemas.statsQuery, 'query'), controllers.stats.dashboard);

  return router;
}
