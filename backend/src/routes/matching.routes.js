import express from 'express';
import { createMatchController } from '../controllers/matching/match.controller.js';
import { ForbiddenError } from '../exceptions/matching.errors.js';

/**
 * Same shape as the other domain routers: receives the services and requireAuth.
 *
 *   GET   /matches                               my matches (?status=&page=&limit=)
 *   GET   /matches/:id                           one match + history + the other declaration
 *   POST  /matches/:id/respond                   {action: accept|reject|needs_info, feedback?}
 *   POST  /matches/:id/recovered                 object handed back
 *   GET   /declarations/:declarationId/matches   matches of one of my declarations (best first)
 *   GET   /admin/matches                         all matches (?status=&disputed=true)
 *
 * (mounted under /api/v1 by routes/index.js)
 */
export function createMatchingRouter({ matchingService, requireAuth }) {
  const router = express.Router();
  const c = createMatchController({ matchingService });

  // role 'admin' is assumed (confirm the real admin role value in constants/users)
  const requireAdmin = (req, res, next) =>
    req.user?.role === 'admin' ? next() : next(new ForbiddenError('Administrators only'));

  router.get('/matches', requireAuth, c.listMine);
  router.get('/matches/:id', requireAuth, c.getOne);
  router.post('/matches/:id/respond', requireAuth, c.respond);
  router.post('/matches/:id/recovered', requireAuth, c.markRecovered);
  router.get('/declarations/:declarationId/matches', requireAuth, c.listForDeclaration);
  router.get('/admin/matches', requireAuth, requireAdmin, c.listAll);

  return router;
}