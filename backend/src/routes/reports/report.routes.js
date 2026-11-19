import { Router } from 'express';
import { validate } from '../../middlewares/common/validate.js';

export function createReportRoutes({ reportController, requireAuth, createReportBodySchema }) {
  const router = Router();

  // Any logged-in user can flag a declaration. Suspended accounts are refused by requireAuth.
  router.use(requireAuth);

  router.post('/', validate(createReportBodySchema), reportController.create);

  return router;
}
