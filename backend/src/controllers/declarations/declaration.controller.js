import { NotFoundError } from '../../exceptions/app-error.js';
import {
  toDeclarationSummary,
  toOwnerDeclarationResponse,
  toPublicDeclarationResponse,
} from '../../presenters/declarations/declaration.presenter.js';

export function createDeclarationController({ declarationService }) {
  // A missing dependency stops the app at startup, not at the first request that needs it.
  if (!declarationService) {
    throw new Error('createDeclarationController(): declarationService is required');
  }

  return {
    async create(req, res) {
      const declaration = await declarationService.create(req.user, req.body, req.picture);

      res.status(201).json({ declaration: toOwnerDeclarationResponse(declaration) });
    },

    async listMine(req, res) {
      const { items, ...pagination } = await declarationService.listMine(req.user, req.query);

      res.status(200).json({ declarations: items.map(toDeclarationSummary), pagination });
    },

    async getById(req, res) {
      const { declaration, isOwner, canSeePrivate, ownerDeleted, allowedTransitions } =
        await declarationService.getById(req.user, req.params.id);

      // The service decides who may see private data. The controller only picks the matching
      // presenter, so a private field is never serialized for someone who must not see it.
      res.status(200).json({
        declaration: canSeePrivate
          ? toOwnerDeclarationResponse(declaration)
          : toPublicDeclarationResponse(declaration),
        isOwner,
        ownerDeleted,
        allowedTransitions,
      });
    },

    async update(req, res) {
      const declaration = await declarationService.update(req.user, req.params.id, req.body);

      res.status(200).json({ declaration: toOwnerDeclarationResponse(declaration) });
    },

    async changeStatus(req, res) {
      const declaration = await declarationService.changeStatus(
        req.user,
        req.params.id,
        req.body.status,
      );

      res.status(200).json({ declaration: toOwnerDeclarationResponse(declaration) });
    },

    async getPicture(req, res, next) {
      const { filePath, contentType } = await declarationService.getPicture(
        req.user,
        req.params.id,
      );

      res.type(contentType);
      res.set({
        // The browser must show the file as the image type we checked, never guess another one.
        'X-Content-Type-Options': 'nosniff',
        // Private: the picture follows the declaration's visibility, so no shared cache may keep
        // it. no-cache makes the browser ask again, so a hidden or deleted declaration stops
        // serving its picture.
        'Cache-Control': 'private, no-cache',
        'Content-Disposition': 'inline',
      });
      // dotfiles: 'allow' because sendFile refuses any path containing a dot folder by default,
      // and the upload folder can live inside one.
      res.sendFile(filePath, { dotfiles: 'allow' }, (err) => {
        // Nothing can be changed once the transfer has started.
        if (!err || res.headersSent) return;
        // Remove the image headers set above, otherwise the JSON error would be sent as an image.
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Disposition');
        res.removeHeader('X-Content-Type-Options');
        res.removeHeader('Cache-Control');
        // A file missing on disk is a 404 for the client, not a server error.
        next(err.code === 'ENOENT' ? new NotFoundError('Picture not found') : err);
      });
    },

    async setPicture(req, res) {
      const declaration = await declarationService.setPicture(req.user, req.params.id, req.picture);

      res.status(200).json({ declaration: toOwnerDeclarationResponse(declaration) });
    },

    async removePicture(req, res) {
      const declaration = await declarationService.removePicture(req.user, req.params.id);

      res.status(200).json({ declaration: toOwnerDeclarationResponse(declaration) });
    },

    async remove(req, res) {
      await declarationService.remove(req.user, req.params.id);

      res.status(204).end();
    },
  };
}
