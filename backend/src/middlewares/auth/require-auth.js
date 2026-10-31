import { ForbiddenError, UnauthenticatedError } from '../../exceptions/app-error.js';

const BEARER = /^Bearer\s+(\S+)$/i;

export function createRequireAuth({ tokenService, userRepository }) {
  return async function requireAuth(req, res, next) {
    const match = BEARER.exec(req.get('Authorization') ?? '');
    if (!match) throw new UnauthenticatedError();

    const { userId } = tokenService.verifyAccessToken(match[1]);
    // Reload the user on every request instead of trusting the token alone, so a suspension or
    // an account deletion applies immediately and not when the access token expires.
    const user = await userRepository.findById(userId);
    // A deleted account gets the same answer as a bad token, so it looks like an unknown one.
    // Suspension is a distinct 403 so the user knows why they are blocked.
    if (!user || user.deletedAt) throw new UnauthenticatedError('Invalid or expired token');
    if (!user.isActive) throw new ForbiddenError('Your account is suspended');

    req.user = user;
    next();
  };
}
