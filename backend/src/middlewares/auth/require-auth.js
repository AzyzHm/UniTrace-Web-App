import { ForbiddenError, UnauthenticatedError } from '../../exceptions/app-error.js';

const BEARER = /^Bearer\s+(\S+)$/i;

export function createRequireAuth({ tokenService, userRepository }) {
  return async function requireAuth(req, res, next) {
    const match = BEARER.exec(req.get('Authorization') ?? '');
    if (!match) throw new UnauthenticatedError();

    const { userId } = tokenService.verifyAccessToken(match[1]);
    const user = await userRepository.findById(userId);
    if (!user || user.deletedAt) throw new UnauthenticatedError('Invalid or expired token');
    if (!user.isActive) throw new ForbiddenError('Your account is suspended');

    req.user = user;
    next();
  };
}
