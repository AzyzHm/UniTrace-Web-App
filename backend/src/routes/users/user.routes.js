import { Router } from 'express';
import { noLimit } from '../../middlewares/common/rate-limiters.js';
import { validate } from '../../middlewares/common/validate.js';

export function createUserRoutes({
  userController,
  requireAuth,
  updateProfileSchema,
  changePasswordSchema,
  deleteAccountSchema,
  rateLimiters = {},
}) {
  const router = Router();
  const { authFailures = noLimit } = rateLimiters;

  // Applied once: every route in this group needs a logged in user.
  router.use(requireAuth);

  router.get('/me', userController.me);
  router.patch('/me', validate(updateProfileSchema), userController.updateMe);
  // These two routes check the current password, so wrong guesses are limited like a login.
  router.patch(
    '/me/password',
    authFailures,
    validate(changePasswordSchema),
    userController.changePassword,
  );
  router.delete('/me', authFailures, validate(deleteAccountSchema), userController.deleteMe);

  return router;
}
