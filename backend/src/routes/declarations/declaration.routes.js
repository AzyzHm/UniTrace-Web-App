import { Router } from 'express';
import { validate } from '../../middlewares/common/validate.js';

export function createDeclarationRoutes({
  declarationController,
  requireAuth,
  createDeclarationSchema,
  listMyDeclarationsQuerySchema,
  declarationIdParamsSchema,
  updateDeclarationSchema,
  changeDeclarationStatusSchema,
  pictureBodySchema,
  uploadPicture,
  requirePicture,
  parseMultipartAttributes,
}) {
  const router = Router();

  router.use(requireAuth);

  // The multipart body is not parsed yet, so uploadPicture runs before validation. Attributes
  // arrive as a JSON string in a multipart form and are parsed back into an object first.
  router.post(
    '/',
    uploadPicture,
    parseMultipartAttributes,
    validate(createDeclarationSchema),
    declarationController.create,
  );

  // Must stay above '/:id', otherwise 'mine' would be read as an id.
  router.get(
    '/mine',
    validate(listMyDeclarationsQuerySchema, 'query'),
    declarationController.listMine,
  );

  router.get('/:id', validate(declarationIdParamsSchema, 'params'), declarationController.getById);

  router.patch(
    '/:id',
    validate(declarationIdParamsSchema, 'params'),
    validate(updateDeclarationSchema),
    declarationController.update,
  );

  router.patch(
    '/:id/status',
    validate(declarationIdParamsSchema, 'params'),
    validate(changeDeclarationStatusSchema),
    declarationController.changeStatus,
  );

  router.delete(
    '/:id',
    validate(declarationIdParamsSchema, 'params'),
    declarationController.remove,
  );

  router.get(
    '/:id/picture',
    validate(declarationIdParamsSchema, 'params'),
    declarationController.getPicture,
  );

  // pictureBodySchema is empty on purpose: this route accepts the file and nothing else.
  router.put(
    '/:id/picture',
    validate(declarationIdParamsSchema, 'params'),
    uploadPicture,
    requirePicture,
    validate(pictureBodySchema),
    declarationController.setPicture,
  );

  router.delete(
    '/:id/picture',
    validate(declarationIdParamsSchema, 'params'),
    declarationController.removePicture,
  );

  return router;
}
