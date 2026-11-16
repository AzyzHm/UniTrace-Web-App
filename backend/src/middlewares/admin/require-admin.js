import { ForbiddenError } from '../../exceptions/app-error.js';
import { isAdminRole } from '../../constants/common/roles.js';

// Must run after requireAuth, which loads req.user. Regular users get 403 here.
export function requireAdmin(req, res, next) {
  if (!isAdminRole(req.user?.role)) {
    throw new ForbiddenError('Admin role required');
  }
  next();
}
