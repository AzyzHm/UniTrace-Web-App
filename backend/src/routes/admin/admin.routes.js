import { Router } from 'express';
import { requireAdmin } from '../../middlewares/admin/require-admin.js';
import { validate } from '../../middlewares/common/validate.js';

export function createAdminRoutes({
  adminUserController,
  requireAuth,
  listUsersQuerySchema,
  userIdParamsSchema,
  deleteUserBodySchema,
}) {
  const router = Router();

  // Every route here needs a logged in admin. The role check runs before validation, so a
  // regular user learns nothing about the rules.
  router.use(requireAuth, requireAdmin);

  router.get('/users', validate(listUsersQuerySchema, 'query'), adminUserController.list);
  router.delete(
    '/users/:id',
    validate(userIdParamsSchema, 'params'),
    validate(deleteUserBodySchema),
    adminUserController.remove,
  );

  return router;
}
