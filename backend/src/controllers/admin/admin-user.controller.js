import { toAdminUserSummary } from '../../presenters/admin/user-admin.presenter.js';

export function createAdminUserController({ adminUserService }) {
  if (!adminUserService) {
    throw new Error('createAdminUserController(): adminUserService is required');
  }

  return {
    async list(req, res) {
      const { items, page, limit, total } = await adminUserService.list(req.query);

      res.status(200).json({
        users: items.map(toAdminUserSummary),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    },

    async remove(req, res) {
      await adminUserService.deleteUser(req.user, req.params.id, req.body);

      res.status(204).end();
    },
  };
}
