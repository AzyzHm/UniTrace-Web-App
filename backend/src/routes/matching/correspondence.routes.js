import { Router } from 'express';
import { validate } from '../../middlewares/common/validate.js';

export function createCorrespondenceRoutes({
  correspondenceController,
  requireAuth,
  correspondenceIdParamsSchema,
  correspondenceDeclarationParamsSchema,
  listCorrespondencesQuerySchema,
  reactionBodySchema,
}) {
  const router = Router();

  router.use(requireAuth);

  // The literal paths must stay above '/:id', otherwise 'me' or 'declaration' would be read as an id.
  router.get(
    '/me',
    validate(listCorrespondencesQuerySchema, 'query'),
    correspondenceController.listMine,
  );

  router.get(
    '/declaration/:declarationId',
    validate(correspondenceDeclarationParamsSchema, 'params'),
    correspondenceController.listForDeclaration,
  );

  router.post(
    '/declaration/:declarationId/rematch',
    validate(correspondenceDeclarationParamsSchema, 'params'),
    correspondenceController.rematch,
  );

  router.get(
    '/:id',
    validate(correspondenceIdParamsSchema, 'params'),
    correspondenceController.getOne,
  );

  for (const action of ['accept', 'refuse', 'verify']) {
    router.post(
      `/:id/${action}`,
      validate(correspondenceIdParamsSchema, 'params'),
      validate(reactionBodySchema),
      correspondenceController[action],
    );
  }

  router.post(
    '/:id/recover',
    validate(correspondenceIdParamsSchema, 'params'),
    correspondenceController.recover,
  );

  return router;
}
