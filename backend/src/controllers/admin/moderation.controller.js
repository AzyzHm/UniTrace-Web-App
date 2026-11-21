import { toOwnerDeclarationResponse } from '../../presenters/declarations/declaration.presenter.js';

export function createModerationController({ moderationService }) {
  if (!moderationService) {
    throw new Error('createModerationController(): moderationService is required');
  }

  return {
    async hide(req, res) {
      const declaration = await moderationService.hide(req.user, req.params.id, req.body);

      res.status(200).json({ declaration: toOwnerDeclarationResponse(declaration) });
    },

    async restore(req, res) {
      const declaration = await moderationService.restore(req.user, req.params.id, req.body);

      res.status(200).json({ declaration: toOwnerDeclarationResponse(declaration) });
    },

    async remove(req, res) {
      await moderationService.delete(req.user, req.params.id, req.body);

      res.status(204).end();
    },
  };
}
